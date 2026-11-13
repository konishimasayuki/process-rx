"""
process-rx FAX取込アプリ(薬局PCで常駐)

FAXフォルダに新しいPDFが届いたら:
  1. process-rx(クラウド)へ送る → 患者さんごとに分けてA4横・左右2面に合体
  2. 合体したPDFを「合体済み」フォルダに保存
  3. 処方箋のPDFを自動で印刷(SumatraPDFを使用。無ければ初回に自動ダウンロード)

ダウンロードした場所から起動すると C:\\process-rx に自分をコピーしてそこで動きます。
FAXフォルダ・自動印刷のオン/オフ・プリンタは process-rx の「設定」画面で変更します。
初回起動時は合言葉だけ聞いて config.json に保存します。
"""

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import zipfile
import sys
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

APP_TITLE = "process-rx FAX取込"
AGENT_VERSION = "1.2.0"
API_BASE = "https://process-rx.vercel.app"
DEFAULT_FAX_FOLDER = r"\\192.168.11.1\シェアード\fax"
POLL_INTERVAL_SECONDS = 15
STABLE_SECONDS = 10  # 書き込み中のファイルを避けるため、最終更新から待つ秒数
MAX_UPLOAD_BYTES = 3_000_000  # これを超えるPDFはクラウドに送れない
MAX_ATTEMPTS = 5  # 壊れたPDFなどで失敗し続けた場合の上限
INSTALL_DIR = Path(r"C:\process-rx")
SUMATRA_URL = "https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip"


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


APP_DIR = app_dir()
logger = logging.getLogger("process-rx-agent")


def config_path() -> Path:
    return APP_DIR / "config.json"


def state_path() -> Path:
    return APP_DIR / "agent_state.json"


def output_dir() -> Path:
    return APP_DIR / "合体済み"


def setup_logging() -> None:
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(message)s", "%m/%d %H:%M:%S")
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    logger.addHandler(console)
    file_handler = RotatingFileHandler(
        APP_DIR / "agent.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)


# ---------- 設定 ----------

def ask(prompt: str, default: str = "") -> str:
    suffix = f" [Enterで「{default}」]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def ask_yes_no(prompt: str, default_yes: bool = True) -> bool:
    hint = "Y/n" if default_yes else "y/N"
    value = input(f"{prompt} ({hint}): ").strip().lower()
    if not value:
        return default_yes
    return value in ("y", "yes", "はい")


def first_time_setup() -> dict:
    print("=" * 50)
    print(f" {APP_TITLE} 初期設定")
    print("=" * 50)
    secret = ""
    while not secret:
        secret = input("合言葉(VercelのFAX_SHARED_SECRETと同じ文字列): ").strip()
    startup = ask_yes_no("パソコン起動時にこのアプリを自動で起動しますか？")

    config = {"secret": secret, "api_base": API_BASE}
    save_config(config)
    print("設定を保存しました。FAXフォルダや自動印刷は process-rx の「設定」画面で変更できます。")
    if startup:
        register_startup()
    return config


def save_config(config: dict) -> None:
    config_path().write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def load_config() -> dict:
    if config_path().exists():
        config = json.loads(config_path().read_text(encoding="utf-8"))
        config.setdefault("api_base", API_BASE)
        return config
    return first_time_setup()


def register_startup() -> None:
    if os.name != "nt":
        return
    startup_dir = (
        Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    )
    bat = startup_dir / "process-rx-agent.bat"
    content = f'@echo off\r\nstart "" /min "{sys.executable}"\r\n'
    try:
        encoding = "mbcs"
        content.encode(encoding)
    except LookupError:
        encoding = "cp932"
    bat.write_text(content, encoding=encoding, errors="replace")
    print(f"自動起動に登録しました: {bat}")


# ---------- インストール / 二重起動防止 ----------

def ensure_installed() -> bool:
    """ダウンロードした場所から起動されたら C:\\process-rx にコピーしてそちらで起動し直す。
    コピーして起動し直した場合は True を返す(この起動はここで終わる)"""
    if not getattr(sys, "frozen", False) or os.name != "nt":
        return False

    target_dir = INSTALL_DIR
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        target_dir = Path(os.environ["LOCALAPPDATA"]) / "process-rx"
        target_dir.mkdir(parents=True, exist_ok=True)

    current = Path(sys.executable).resolve()
    target = target_dir / "process-rx-agent.exe"
    if current.parent == target_dir.resolve():
        return False

    try:
        shutil.copy2(current, target)
    except PermissionError:
        print("すでにアプリが起動中のため更新できません。")
        print("黒い画面(process-rx FAX取込)を閉じてから、もう一度実行してください。")
        input("Enterキーで閉じます")
        return True

    subprocess.Popen(
        [str(target)], cwd=str(target_dir), creationflags=subprocess.CREATE_NEW_CONSOLE
    )
    print(f"{target_dir} にインストールしました。新しい画面で起動します。")
    time.sleep(3)
    return True


_mutex_handle = None


def already_running() -> bool:
    global _mutex_handle
    if os.name != "nt":
        return False
    import ctypes

    _mutex_handle = ctypes.windll.kernel32.CreateMutexW(None, False, "process-rx-agent-single")
    return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS


_last_sumatra_try = 0.0


def ensure_sumatra() -> None:
    """自動印刷に使うSumatraPDFが無ければ公式サイトからダウンロードする(失敗時は10分おきに再試行)"""
    global _last_sumatra_try
    if find_sumatra() or time.time() - _last_sumatra_try < 600:
        return
    _last_sumatra_try = time.time()
    logger.info("印刷用ソフト(SumatraPDF)をダウンロードしています…")
    zip_path = APP_DIR / "sumatra.zip"
    try:
        res = requests.get(SUMATRA_URL, timeout=120)
        res.raise_for_status()
        zip_path.write_bytes(res.content)
        with zipfile.ZipFile(zip_path) as z:
            exe_name = next(n for n in z.namelist() if n.lower().endswith(".exe"))
            (APP_DIR / "SumatraPDF.exe").write_bytes(z.read(exe_name))
        logger.info("印刷用ソフトの準備ができました")
    except Exception as err:  # noqa: BLE001
        logger.error("印刷用ソフトのダウンロードに失敗しました(10分後に再試行): %s", err)
    finally:
        zip_path.unlink(missing_ok=True)


# ---------- 状態(取込済みファイル・印刷済みID) ----------

def load_state():
    if state_path().exists():
        try:
            data = json.loads(state_path().read_text(encoding="utf-8"))
            return {
                "files": set(data.get("files", [])),
                "printed": set(data.get("printed", [])),
                "attempts": dict(data.get("attempts", {})),
                "folder": data.get("folder"),
                "handled_commands": list(data.get("handled_commands", [])),
                "command_results": dict(data.get("command_results", {})),
            }
        except (json.JSONDecodeError, OSError):
            logger.warning("状態ファイルの読み込みに失敗しました。空の状態から始めます")
    return None


def save_state(state: dict) -> None:
    data = {
        "files": sorted(state["files"]),
        "printed": sorted(state["printed"]),
        "attempts": state["attempts"],
        "folder": state.get("folder"),
        "handled_commands": state.get("handled_commands", [])[-20:],
        "command_results": state.get("command_results", {}),
    }
    state_path().write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------- スリープ防止 ----------

def keep_awake() -> None:
    if os.name != "nt":
        return
    import ctypes

    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)


# ---------- 印刷 ----------

PRINT_ERRORS = {
    2: "ファイルを開けません",
    3: "このPDFは印刷が許可されていません",
    4: "プリンタが見つかりません(プリンタ名を確認してください)",
    5: "プリンタのドライバでエラーが起きました",
}


def find_sumatra():
    for path in sorted(APP_DIR.glob("SumatraPDF*.exe")):
        return path
    return None


def print_pdf(pdf_path: Path, settings: dict) -> bool:
    sumatra = find_sumatra()
    if not sumatra:
        logger.error("印刷できません: SumatraPDF.exe がアプリと同じフォルダにありません")
        return False

    args = [str(sumatra), "-print-settings", "fit,paper=A4"]
    if settings.get("printer"):
        args += ["-print-to", settings["printer"]]
    else:
        args += ["-print-to-default"]
    args += ["-silent", str(pdf_path)]

    try:
        result = subprocess.run(args, timeout=180)
    except subprocess.TimeoutExpired:
        logger.error("印刷がタイムアウトしました: %s", pdf_path.name)
        return False

    if result.returncode != 0:
        reason = PRINT_ERRORS.get(result.returncode, f"コード{result.returncode}")
        logger.error("印刷に失敗しました(%s): %s", reason, pdf_path.name)
        return False
    return True


# ---------- サーバーの設定(画面で変更) ----------

DEFAULT_SETTINGS = {"fax_folder": DEFAULT_FAX_FOLDER, "auto_print": True, "printer": ""}


_pdf_count = None  # FAXフォルダ内のPDFの数(画面に表示するため、設定の取得時に送る)


def fetch_server(config: dict):
    """設定画面の内容と、画面からの依頼(既存FAXの取込など)を取得する(生存確認も兼ねる)。
    取れないときは前回の設定を使う。戻り値: (設定, 依頼またはNone)"""
    try:
        params = {"version": AGENT_VERSION, "host": os.environ.get("COMPUTERNAME", "")}
        if _pdf_count is not None:
            params["pdf_count"] = _pdf_count
        res = requests.get(
            f"{config['api_base']}/api/fax-agent",
            params=params,
            headers={"x-fax-secret": config["secret"]},
            timeout=20,
        )
        if res.status_code == 401:
            logger.error("合言葉が違います。config.json を削除して起動し直し、正しい合言葉を入れてください")
        elif res.status_code == 200:
            body = res.json()
            settings = {**DEFAULT_SETTINGS, **body.get("settings", {})}
            if settings != config.get("server_settings"):
                config["server_settings"] = settings
                save_config(config)
                logger.info(
                    "設定: フォルダ=%s / 自動印刷=%s / プリンタ=%s",
                    settings["fax_folder"],
                    "する" if settings["auto_print"] else "しない",
                    settings["printer"] or "いつも使うプリンタ",
                )
            return settings, body.get("command")
    except requests.RequestException as err:
        logger.warning("設定の取得に失敗しました(前回の設定で続行): %s", err)
    return {**DEFAULT_SETTINGS, **config.get("server_settings", {})}, None


def fetch_settings(config: dict) -> dict:
    return fetch_server(config)[0]


def report_command(config: dict, command_id: str, status: str, progress=None, result=None) -> None:
    try:
        requests.post(
            f"{config['api_base']}/api/fax-agent",
            json={"command_id": command_id, "status": status, "progress": progress, "result": result},
            headers={"x-fax-secret": config["secret"]},
            timeout=20,
        )
    except requests.RequestException:
        pass  # 画面の進み具合表示用なので、失敗しても取込自体は続ける


def report_printed(item_id: str, config: dict) -> None:
    try:
        requests.post(
            f"{config['api_base']}/api/fax-printed",
            json={"id": item_id},
            headers={"x-fax-secret": config["secret"]},
            timeout=20,
        )
    except requests.RequestException:
        pass  # 一覧の「印刷済」表示用なので失敗しても印刷には影響しない


# ---------- 取込 ----------

def safe_name(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\s]+', "_", text or "")
    return text[:40] or "不明"


def upload(pdf_path: Path, config: dict, extra=None):
    payload = {
        "filename": pdf_path.name,
        "pdf_base64": base64.b64encode(pdf_path.read_bytes()).decode("ascii"),
        **(extra or {}),
    }
    return requests.post(
        f"{config['api_base']}/api/fax-intake",
        json=payload,
        headers={"x-fax-secret": config["secret"]},
        timeout=180,
    )


def download_pdf(item_id: str, config: dict):
    res = requests.get(
        f"{config['api_base']}/api/fax-pdf",
        params={"id": item_id},
        headers={"x-fax-secret": config["secret"]},
        timeout=60,
    )
    if res.status_code != 200:
        return None
    return res.content


def process_file(pdf_path: Path, config: dict, settings: dict, state: dict, size: int) -> bool:
    """True: 取込完了(次回以降は無視) / False: 次回また試す"""
    if size > MAX_UPLOAD_BYTES:
        logger.error(
            "大きすぎて取り込めません(%.1fMB): %s ※手動で印刷してください",
            size / 1_000_000,
            pdf_path.name,
        )
        return True

    logger.info("新しいFAX: %s", pdf_path.name)
    res = upload(pdf_path, config)

    if res.status_code == 401:
        logger.error("合言葉が違います。config.json の secret とVercelの設定を確認してください")
        return False
    if res.status_code == 400:
        attempts = state["attempts"].get(pdf_path.name, 0) + 1
        state["attempts"][pdf_path.name] = attempts
        logger.error("PDFを読み込めません(%d回目): %s", attempts, pdf_path.name)
        return attempts >= MAX_ATTEMPTS
    if res.status_code != 200:
        logger.error("送信に失敗しました(%s)。あとで再試行します", res.status_code)
        return False

    data = res.json()
    items = data.get("items") or []
    day_dir = output_dir() / datetime.now().strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%H%M%S")

    printed_count = 0
    for index, item in enumerate(items, start=1):
        if not item.get("has_pdf", True):
            logger.error("合体PDFがサーバーに保存されていません(大きすぎ): %s", item.get("id"))
            continue

        pdf_bytes = download_pdf(item["id"], config)
        if pdf_bytes is None:
            logger.error("合体PDFの取得に失敗しました。あとで再試行します")
            return False

        label = item.get("patient_name") if item.get("is_prescription", True) else "処方箋以外"
        out_path = day_dir / f"{stamp}_{index}_{safe_name(label)}.pdf"
        out_path.write_bytes(pdf_bytes)

        if not item.get("is_prescription", True):
            continue
        if not settings.get("auto_print") or item["id"] in state["printed"]:
            continue
        if print_pdf(out_path, settings):
            state["printed"].add(item["id"])
            printed_count += 1
            save_state(state)
            report_printed(item["id"], config)

    names = "、".join(
        safe_name(i.get("patient_name")) for i in items if i.get("is_prescription", True)
    )
    logger.info(
        "完了: %d名分に合体 / %d件印刷  %s",
        sum(1 for i in items if i.get("is_prescription", True)),
        printed_count,
        names,
    )
    state["attempts"].pop(pdf_path.name, None)
    return True


def list_pdfs(folder: str):
    """FAXフォルダ内のPDFを (ファイル名, パス, 更新時刻, サイズ) で返す(古い順)。

    NAS(共有フォルダ)では Path.exists() / stat() が WinError 122 で失敗することがあるため、
    フォルダ自体には stat を使わず、一覧取得(scandir)だけで確認する。
    更新時刻・サイズも一覧と一緒に取れる値を使う。"""
    result = []
    with os.scandir(folder) as entries:
        for entry in entries:
            if entry.name.lower().endswith(".pdf") and entry.is_file():
                info = entry.stat()
                result.append((entry.name, Path(entry.path), info.st_mtime, info.st_size))
    return sorted(result, key=lambda item: item[2])


_last_folder_error = {"text": "", "at": 0.0}


def report_folder_error(folder: str, err: Exception) -> None:
    """フォルダを開けないときの記録。同じ内容は10分に1回だけ出す(15秒ごとの連続表示を防ぐ)"""
    text = f"{type(err).__name__}: {err}"
    now = time.time()
    if text != _last_folder_error["text"] or now - _last_folder_error["at"] > 600:
        logger.warning("FAXフォルダを開けません: %s ／ %s", folder, text)
        logger.warning("→ エクスプローラーで同じ場所が開けるか、パスや認証情報を確認してください")
        _last_folder_error.update(text=text, at=now)


def seed_folder(folder: str, pdfs, state: dict) -> None:
    state["files"].update(name for name, _, _, _ in pdfs)
    state["folder"] = folder
    save_state(state)
    logger.info("このフォルダに今あるFAX %d件は取り込まず、これから届くFAXを取り込みます", len(pdfs))


def run_once(config: dict, settings: dict, state: dict) -> None:
    folder = settings["fax_folder"]
    try:
        pdfs = list_pdfs(folder)
    except OSError as err:
        report_folder_error(folder, err)
        return
    _last_folder_error["text"] = ""
    global _pdf_count
    _pdf_count = len(pdfs)

    # 初回、または設定画面でフォルダが変わったときは、今あるファイルを取り込まない
    if state.get("folder") != folder:
        seed_folder(folder, pdfs, state)
        return

    if settings.get("auto_print"):
        ensure_sumatra()

    now = time.time()
    for name, pdf_path, mtime, size in pdfs:
        if name in state["files"]:
            continue
        if now - mtime < STABLE_SECONDS:
            continue  # まだ書き込み中かもしれない
        try:
            done = process_file(pdf_path, config, settings, state, size)
        except requests.RequestException as err:
            logger.error("通信エラー: %s(あとで再試行します)", err)
            done = False
        except OSError as err:
            logger.error("ファイルを読み込めません(%s): %s", name, err)
            done = False
        if done:
            state["files"].add(name)
            save_state(state)


def handle_command(command: dict, config: dict, settings: dict, state: dict) -> None:
    """画面からの依頼を実行する。いまは「フォルダにある既存FAXの取込」のみ。
    新しい順に指定件数を取り込み(古い順にアップロード)、印刷や保存はしない。"""
    if command.get("type") != "import_existing":
        return
    cid = command["id"]
    handled = state.setdefault("handled_commands", [])
    results = state.setdefault("command_results", {})
    if cid in handled:
        # 完了の報告だけ届いていなかった場合は、前回の結果をもう一度報告する
        report_command(config, cid, "done", result=results.get(cid))
        return

    folder = settings["fax_folder"]
    count = int(command.get("count") or 5)
    logger.info("画面からの依頼: フォルダの新しいFAX %d件を取り込みます(印刷はしません)", count)
    report_command(config, cid, "running", progress="フォルダを確認中")

    try:
        pdfs = list_pdfs(folder)
    except OSError as err:
        logger.error("FAXフォルダを開けません: %s", err)
        result = {"error": f"FAXフォルダを開けません: {err}"}
        handled.append(cid)
        results[cid] = result
        save_state(state)
        report_command(config, cid, "failed", result=result)
        return

    newest = sorted(pdfs, key=lambda item: item[2], reverse=True)[:count]
    targets = sorted(newest, key=lambda item: item[2])  # 古い順(新しいFAXが一覧の上に来る)
    result = {"total": len(targets), "uploaded": 0, "duplicate": 0, "too_large": 0, "failed": 0}

    for index, (name, pdf_path, mtime, size) in enumerate(targets, start=1):
        report_command(config, cid, "running", progress=f"{index - 1}/{len(targets)}")
        if size > MAX_UPLOAD_BYTES:
            logger.error("大きすぎて取り込めません(%.1fMB): %s", size / 1_000_000, name)
            result["too_large"] += 1
            continue
        try:
            res = upload(
                pdf_path,
                config,
                {
                    "imported": True,
                    "original_time": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
                },
            )
        except (requests.RequestException, OSError) as err:
            logger.error("取込に失敗しました(%s): %s", name, err)
            result["failed"] += 1
            continue
        if res.status_code == 200:
            if res.json().get("status") == "duplicate":
                result["duplicate"] += 1
            else:
                result["uploaded"] += 1
            state["files"].add(name)
            logger.info("取込 %d/%d: %s", index, len(targets), name)
        else:
            logger.error("取込に失敗しました(%s): 状態%s", name, res.status_code)
            result["failed"] += 1

    handled.append(cid)
    results[cid] = result
    save_state(state)
    report_command(config, cid, "done", progress=f"{len(targets)}/{len(targets)}", result=result)
    logger.info(
        "取込が終わりました: 新規%d件 / 取込済み%d件 / 大きすぎ%d件 / 失敗%d件",
        result["uploaded"],
        result["duplicate"],
        result["too_large"],
        result["failed"],
    )


def main() -> None:
    if ensure_installed():
        return
    if already_running():
        print("このアプリはすでに起動しています(二重に起動すると二重印刷になるため終了します)。")
        time.sleep(5)
        return
    if os.name == "nt":
        os.system(f"title {APP_TITLE}")
    setup_logging()
    config = load_config()
    keep_awake()

    state = load_state() or {"files": set(), "printed": set(), "attempts": {}, "folder": None}
    logger.info("起動しました(ver %s)。※この画面は閉じないでください(最小化はOK)", AGENT_VERSION)

    while True:
        try:
            settings, command = fetch_server(config)
            run_once(config, settings, state)
            if command:
                handle_command(command, config, settings, state)
        except Exception as err:  # noqa: BLE001 常駐を止めないため
            logger.exception("予期しないエラー: %s", err)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as err:  # noqa: BLE001
        print(f"エラーで停止しました: {err}")
        input("Enterキーで閉じます")
