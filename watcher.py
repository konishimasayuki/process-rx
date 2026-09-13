"""
FAXフォルダ監視エージェント
\\192.168.11.1\シェアード\fax を定期的にポーリングし、
新着PDFをVercelのAPIにアップロードする。

【使い方】
1. Python 3.10+ をインストール
2. pip install requests
3. 下記の設定値を環境に合わせて書き換える
4. python watcher.py で起動（常駐させる場合はタスクスケジューラ or NSSMでサービス化）
"""

import base64
import json
import logging
import time
from pathlib import Path

import requests

# ==== 設定値 ====
FAX_FOLDER = r"\\192.168.11.1\シェアード\fax"
UPLOAD_URL = "https://<your-project>.vercel.app/api/fax-intake"
SHARED_SECRET = "ここに共有シークレットを設定"
POLL_INTERVAL_SECONDS = 15
PROCESSED_LOG_PATH = Path(__file__).parent / "processed_files.json"
# =================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("fax-watcher")


def load_processed() -> set:
    if PROCESSED_LOG_PATH.exists():
        try:
            with open(PROCESSED_LOG_PATH, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except (json.JSONDecodeError, OSError):
            logger.warning("processed_files.jsonの読み込みに失敗。空の状態から開始します。")
    return set()


def save_processed(processed: set) -> None:
    with open(PROCESSED_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted(processed), f, ensure_ascii=False, indent=2)


def upload_pdf(pdf_path: Path) -> bool:
    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    except OSError as e:
        logger.error("ファイル読み込み失敗 %s: %s", pdf_path, e)
        return False

    payload = {
        "filename": pdf_path.name,
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
    }

    try:
        response = requests.post(
            UPLOAD_URL,
            json=payload,
            headers={"x-fax-secret": SHARED_SECRET},
            timeout=120,
        )
    except requests.RequestException as e:
        logger.error("アップロード通信失敗 %s: %s", pdf_path.name, e)
        return False

    if response.status_code == 200:
        logger.info("アップロード成功: %s -> %s", pdf_path.name, response.json())
        return True

    logger.error(
        "アップロード失敗 %s: status=%s body=%s",
        pdf_path.name,
        response.status_code,
        response.text,
    )
    return False


def main() -> None:
    logger.info("FAX監視エージェント起動: %s を監視します", FAX_FOLDER)
    processed = load_processed()

    while True:
        try:
            folder = Path(FAX_FOLDER)
            if not folder.exists():
                logger.warning("フォルダにアクセスできません: %s", FAX_FOLDER)
            else:
                pdf_files = sorted(folder.glob("*.pdf"))
                for pdf_path in pdf_files:
                    if pdf_path.name in processed:
                        continue

                    logger.info("新着PDF検知: %s", pdf_path.name)
                    success = upload_pdf(pdf_path)
                    if success:
                        processed.add(pdf_path.name)
                        save_processed(processed)
        except Exception as e:  # noqa: BLE001 常駐プロセスを落とさないための広めの捕捉
            logger.exception("監視ループで予期しないエラー: %s", e)

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
