"""
process-rx FAX取込アプリ(薬局PCで常駐)

FAXフォルダに新しいPDFが届いたら:
  1. process-rx(クラウド)へ送る → 患者さんごとに分けてA4横・左右2面に合体
  2. 合体したPDFを「合体済み」フォルダに保存
  3. 処方箋のPDFを自動で印刷(SumatraPDFを使用)

初回起動時に合言葉などを聞いて config.json に保存します。
"""

import base64
import json
import logging
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

APP_TITLE = "process-rx FAX取込"
API_BASE = "https://process-rx.vercel.app"
DEFAULT_FAX_FOLDER = r"\\192.168.11.1\シェアード\fax"
POLL_INTERVAL_SECONDS = 15
STABLE_SECONDS = 10  # 書き込み中のファイルを避けるため、最終更新から待つ秒数
MAX_UPLOAD_BYTES = 3_000_000  # これを超えるPDFはクラウドに送れない
MAX_ATTEMPTS = 5  # 壊れたPDFなどで失敗し続けた場合の上限


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
    folder = ask("FAXが保存されるフォルダ", DEFAULT_FAX_FOLDER)
    auto_print = ask_yes_no("届いた処方箋を自動で印刷しますか？")
    printer = ""
    if auto_print:
        printer = ask("印刷するプリンタ名(空欄ならいつも使うプリンタ)", "")
    startup = ask_yes_no("パソコン起動時にこのアプリを自動で起動しますか？")

    config = {
        "secret": secret,
        "fax_folder": folder,
        "auto_print": auto_print,
        "printer": printer,
        "api_base": API_BASE,
    }
    config_path().write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print("設定を保存しました: config.json(変更したいときはこのファイルを削除して再起動)")

    if startup:
        register_startup()
    return config


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


# ---------- 状態(取込済みファイル・印刷済みID) ----------

def load_state():
    if state_path().exists():
        try:
            data = json.loads(state_path().read_text(encoding="utf-8"))
            return {
                "files": set(data.get("files", [])),
                "printed": set(data.get("printed", [])),
                "attempts": dict(data.get("attempts", {})),
            }
        except (json.JSONDecodeError, OSError):
            logger.warning("状態ファイルの読み込みに失敗しました。空の状態から始めます")
    return None


def save_state(state: dict) -> None:
    data = {
        "files": sorted(state["files"]),
        "printed": sorted(state["printed"]),
        "attempts": state["attempts"],
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


def print_pdf(pdf_path: Path, config: dict) -> bool:
    sumatra = find_sumatra()
    if not sumatra:
        logger.error("印刷できません: SumatraPDF.exe がアプリと同じフォルダにありません")
        return False

    args = [str(sumatra), "-print-settings", "fit,paper=A4"]
    if config.get("printer"):
        args += ["-print-to", config["printer"]]
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


# ---------- 取込 ----------

def safe_name(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\s]+', "_", text or "")
    return text[:40] or "不明"


def upload(pdf_path: Path, config: dict):
    payload = {
        "filename": pdf_path.name,
        "pdf_base64": base64.b64encode(pdf_path.read_bytes()).decode("ascii"),
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


def process_file(pdf_path: Path, config: dict, state: dict) -> bool:
    """True: 取込完了(次回以降は無視) / False: 次回また試す"""
    size = pdf_path.stat().st_size
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
        if not config.get("auto_print") or item["id"] in state["printed"]:
            continue
        if print_pdf(out_path, config):
            state["printed"].add(item["id"])
            printed_count += 1
            save_state(state)

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


def run_once(config: dict, state: dict) -> None:
    folder = Path(config["fax_folder"])
    if not folder.exists():
        logger.warning("FAXフォルダにアクセスできません: %s", folder)
        return

    now = time.time()
    pdfs = sorted(folder.glob("*.pdf"), key=lambda p: p.stat().st_mtime)
    for pdf_path in pdfs:
        if pdf_path.name in state["files"]:
            continue
        if now - pdf_path.stat().st_mtime < STABLE_SECONDS:
            continue  # まだ書き込み中かもしれない
        try:
            done = process_file(pdf_path, config, state)
        except requests.RequestException as err:
            logger.error("通信エラー: %s(あとで再試行します)", err)
            done = False
        if done:
            state["files"].add(pdf_path.name)
            save_state(state)


def main() -> None:
    if os.name == "nt":
        os.system(f"title {APP_TITLE}")
    setup_logging()
    config = load_config()
    keep_awake()

    state = load_state()
    first_run = state is None
    if first_run:
        state = {"files": set(), "printed": set(), "attempts": {}}

    logger.info("起動しました。FAXフォルダ: %s", config["fax_folder"])
    logger.info("自動印刷: %s", "する" if config.get("auto_print") else "しない")
    logger.info("※この画面は閉じないでください(最小化はOK)")

    while True:
        try:
            if first_run:
                folder = Path(config["fax_folder"])
                if folder.exists():
                    existing = [p.name for p in folder.glob("*.pdf")]
                    state["files"].update(existing)
                    save_state(state)
                    logger.info("今あるFAX %d件は取り込まず、これから届くFAXを取り込みます", len(existing))
                    first_run = False
                else:
                    logger.warning("FAXフォルダにアクセスできません: %s", folder)
            else:
                run_once(config, state)
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
