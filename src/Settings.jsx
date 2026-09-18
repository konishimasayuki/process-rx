import { useEffect, useState } from "react";

export default function Settings() {
  const [drivers, setDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverLineId, setNewDriverLineId] = useState("");
  const [driverError, setDriverError] = useState("");

  const [lineInfo, setLineInfo] = useState(null);
  const [tokenInput, setTokenInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [lineSaving, setLineSaving] = useState(false);
  const [lineMessage, setLineMessage] = useState("");

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  async function loadDrivers() {
    setLoadingDrivers(true);
    const res = await fetch("/api/drivers");
    const data = await res.json();
    setDrivers(data.drivers || []);
    setLoadingDrivers(false);
  }

  async function loadLineSettings() {
    const res = await fetch("/api/line-settings");
    const data = await res.json();
    setLineInfo(data);
  }

  async function loadHistory() {
    setLoadingHistory(true);
    const res = await fetch("/api/line-friend-history");
    const data = await res.json();
    setHistory(data.history || []);
    setLoadingHistory(false);
  }

  useEffect(() => {
    loadDrivers();
    loadLineSettings();
    loadHistory();
  }, []);

  async function handleAddDriver(e) {
    e.preventDefault();
    setDriverError("");
    const trimmed = newDriverName.trim();
    if (!trimmed) {
      setDriverError("ドライバー名を入力してください");
      return;
    }
    if (drivers.some((d) => d.name === trimmed)) {
      setDriverError("すでに登録されています");
      return;
    }

    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, line_id: newDriverLineId.trim() }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDriverError(data.error || "登録に失敗しました");
      return;
    }

    setDrivers((prev) =>
      [...prev, { name: trimmed, line_id: newDriverLineId.trim() }].sort(
        (a, b) => a.name.localeCompare(b.name, "ja")
      )
    );
    setNewDriverName("");
    setNewDriverLineId("");
  }

  async function handleUpdateLineId(name, lineId) {
    await fetch("/api/drivers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, line_id: lineId }),
    });
    setDrivers((prev) =>
      prev.map((d) => (d.name === name ? { ...d, line_id: lineId } : d))
    );
  }

  async function handleRemoveDriver(name) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await fetch("/api/drivers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setDrivers((prev) => prev.filter((d) => d.name !== name));
  }

  async function handleSaveLineSettings(e) {
    e.preventDefault();
    setLineSaving(true);
    setLineMessage("");

    const payload = {};
    if (tokenInput.trim()) payload.channel_access_token = tokenInput.trim();
    if (secretInput.trim()) payload.channel_secret = secretInput.trim();

    const res = await fetch("/api/line-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setLineSaving(false);
    if (!res.ok) {
      setLineMessage("保存に失敗しました");
      return;
    }

    setLineMessage("保存しました");
    setTokenInput("");
    setSecretInput("");
    loadLineSettings();
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/line-webhook`
      : "";

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>設定</h2>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>LINE公式アカウント連携</h3>
        <p style={styles.helpText}>
          LINE Developersコンソールで発行した「チャネルアクセストークン」と「チャネルシークレット」を入力してください。
        </p>

        <form style={styles.form} onSubmit={handleSaveLineSettings}>
          <label style={styles.label}>
            チャネルアクセストークン
            {lineInfo?.token_set && (
              <span style={styles.currentValue}>
                設定済み ({lineInfo.token_masked})
              </span>
            )}
            <input
              style={styles.input}
              type="password"
              placeholder="新しい値を入力すると上書きされます"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
          </label>

          <label style={styles.label}>
            チャネルシークレット
            {lineInfo?.secret_set && (
              <span style={styles.currentValue}>
                設定済み ({lineInfo.secret_masked})
              </span>
            )}
            <input
              style={styles.input}
              type="password"
              placeholder="新しい値を入力すると上書きされます"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
            />
          </label>

          {lineMessage && <p style={styles.successText}>{lineMessage}</p>}

          <button style={styles.button} type="submit" disabled={lineSaving}>
            {lineSaving ? "保存中..." : "保存"}
          </button>
        </form>

        <div style={styles.webhookBox}>
          <div style={styles.webhookLabel}>Webhook URL(LINE Developersに設定)</div>
          <code style={styles.webhookUrl}>{webhookUrl}</code>
        </div>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>友達追加履歴</h3>
        <p style={styles.helpText}>
          LINEで公式アカウントが友達追加されると、ここにLINE
          IDが表示されます。コピーしてドライバーのLINE ID欄に入力してください。
        </p>

        {loadingHistory ? (
          <p>読み込み中...</p>
        ) : history.length === 0 ? (
          <p style={styles.muted}>まだ友達追加はありません</p>
        ) : (
          <ul style={styles.historyList}>
            {history.map((h, idx) => (
              <li key={idx} style={styles.historyItem}>
                <span style={styles.historyTime}>
                  {new Date(h.added_at).toLocaleString("ja-JP")}
                </span>
                <code style={styles.historyId}>{h.line_user_id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>ドライバー登録</h3>

        <form style={styles.driverForm} onSubmit={handleAddDriver}>
          <input
            style={styles.input}
            placeholder="ドライバー名"
            value={newDriverName}
            onChange={(e) => setNewDriverName(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="LINE ID(任意・後で設定可)"
            value={newDriverLineId}
            onChange={(e) => setNewDriverLineId(e.target.value)}
          />
          <button style={styles.button} type="submit">
            追加
          </button>
        </form>

        {driverError && <p style={styles.errorText}>{driverError}</p>}

        {loadingDrivers ? (
          <p>読み込み中...</p>
        ) : drivers.length === 0 ? (
          <p style={styles.muted}>まだドライバーが登録されていません</p>
        ) : (
          <ul style={styles.list}>
            {drivers.map((d) => (
              <li key={d.name} style={styles.listItem}>
                <span style={styles.driverName}>{d.name}</span>
                <input
                  style={styles.lineIdInput}
                  placeholder="LINE ID"
                  defaultValue={d.line_id}
                  onBlur={(e) => handleUpdateLineId(d.name, e.target.value)}
                />
                <button
                  style={styles.removeButton}
                  onClick={() => handleRemoveDriver(d.name)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "560px" },
  heading: { fontSize: "1.2rem", marginBottom: "1rem" },
  section: {
    background: "#fff",
    borderRadius: "10px",
    padding: "1rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    marginBottom: "1rem",
  },
  sectionTitle: { fontSize: "0.95rem", marginBottom: "0.4rem" },
  helpText: { fontSize: "0.8rem", color: "#888", marginBottom: "0.8rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    fontSize: "0.85rem",
    color: "#333",
  },
  currentValue: { fontSize: "0.75rem", color: "#16a34a" },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "0.9rem",
  },
  button: {
    padding: "0.6rem 1rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.9rem",
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  successText: { color: "#16a34a", fontSize: "0.85rem", margin: 0 },
  errorText: { color: "#dc2626", fontSize: "0.85rem", margin: "0 0 0.5rem 0" },
  muted: { color: "#888", fontSize: "0.85rem" },
  webhookBox: {
    marginTop: "1rem",
    padding: "0.7rem",
    background: "#f9fafb",
    borderRadius: "8px",
  },
  webhookLabel: { fontSize: "0.75rem", color: "#888", marginBottom: "0.3rem" },
  webhookUrl: {
    fontSize: "0.8rem",
    wordBreak: "break-all",
    color: "#333",
  },
  historyList: { listStyle: "none", padding: 0, margin: 0 },
  historyItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    padding: "0.5rem 0",
    borderBottom: "1px solid #f0f0f0",
    fontSize: "0.85rem",
  },
  historyTime: { color: "#888", fontSize: "0.75rem" },
  historyId: {
    fontSize: "0.85rem",
    color: "#111",
    wordBreak: "break-all",
  },
  driverForm: { display: "flex", gap: "0.5rem", marginBottom: "0.6rem", flexWrap: "wrap" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  listItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0",
    borderBottom: "1px solid #f0f0f0",
    fontSize: "0.9rem",
  },
  driverName: { minWidth: "70px", flexShrink: 0 },
  lineIdInput: {
    flex: 1,
    padding: "0.4rem",
    borderRadius: "5px",
    border: "1px solid #ddd",
    fontSize: "0.8rem",
    minWidth: 0,
  },
  removeButton: {
    fontSize: "0.75rem",
    padding: "0.25rem 0.6rem",
    borderRadius: "5px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    cursor: "pointer",
    flexShrink: 0,
  },
};
