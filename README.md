# process-rx

FAXで届く処方箋PDFを自動解析し、メルフィン(調剤Melphin/DUO)への入力を自動化するシステム。

## 構成
- `agent/process_rx_agent.py`: 薬局PC常駐アプリ。FAX共有フォルダを監視→取込→合体PDFを保存・自動印刷。GitHub Actionsでexe化され、Releases(agent-latest)に置かれる
- `api/fax-intake.js`: PDFを受け取りClaudeで処方箋データを構造化しRedisに保存
- `api/fax-queue.js`: 処方箋キューの一覧取得・ステータス更新
- `api/login.js` / `api/session-check.js` / `api/logout.js`: 仮ログイン機能(初期ID/PW: z/z)
- `src/`: フロントエンド(React + Vite)

## 環境変数(Vercel)
- `ANTHROPIC_API_KEY`
- `FAX_SHARED_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `LOGIN_USERNAME` / `LOGIN_PASSWORD`（未設定時はz/z）

## 今後の予定
- メルフィン画面のショートカットキー調査後、自動入力エージェントを追加
