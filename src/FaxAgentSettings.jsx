import { useEffect, useState } from "react";

function agentStatus(hb) {
  if (!hb) return { label: "まだ接続されていません", color: "#888" };
  const seconds = (Date.now() - new Date(hb.last_seen).getTime()) / 1000;
  const when = new Date(hb.last_seen).toLocaleString("ja-JP");
  if (seconds < 90) return { label: `● 動作中(${hb.host || "PC"} / ver ${hb.version})`, color: "#047857" };
  return { label: `● 停止中(最終接続 ${when})`, color: "#dc2626" };
}

export default function FaxAgentSettings() {
  const [form, setForm] = useState(null);
  const [heartbeat, setHeartbeat] = useState(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/fax-agent");
    if (!res.ok) return;
    const data = await res.json();
    setForm((prev) => prev || data.settings);
    setHeartbeat(data.heartbeat);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/fax-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setMessage(res.ok ? "保存しました(薬局PCには15秒ほどで反映されます)" : data.error || "保存に失敗しました");
  }

  const status = agentStatus(heartbeat);

  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>FAX取込アプリ(薬局PC用)</h3>
      <div style={{ ...styles.status, color: status.color }}>{status.label}</div>

      {form && (
        <form style={styles.form} onSubmit={save}>
          <label style={styles.label}>
            FAXが保存されるフォルダ
            <input
              style={styles.input}
              value={form.fax_folder}
              onChange={(e) => setForm({ ...form, fax_folder: e.target.value })}
            />
          </label>

          <label style={styles.toggleRow}>
            <input
              type="checkbox"
              checked={form.auto_print}
              onChange={(e) => setForm({ ...form, auto_print: e.target.checked })}
            />
            届いた処方箋を自動で印刷する
          </label>

          {form.auto_print && (
            <label style={styles.label}>
              プリンタ名(空欄ならいつも使うプリンタ)
              <input
                style={styles.input}
                value={form.printer}
                placeholder="例: Brother HL-L2375DW"
                onChange={(e) => setForm({ ...form, printer: e.target.value })}
              />
            </label>
          )}

          {message && <p style={styles.message}>{message}</p>}
          <button style={styles.button} type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </form>
      )}

      <div style={styles.downloadBox}>
        <a style={styles.downloadButton} href="/downloads/process-rx-agent.exe" download>
          アプリをダウンロード
        </a>
        <ol style={styles.stepList}>
          <li>FAXフォルダが見える薬局のパソコンでダウンロードして開く(ブラウザの警告は「保存」→「保持する」)</li>
          <li>「WindowsによってPCが保護されました」と出たら「詳細情報」→「実行」</li>
          <li>合言葉を入力し、あとはEnterで進む</li>
          <li>黒い画面は閉じずに最小化しておく</li>
        </ol>
      </div>
    </section>
  );
}

const styles = {
  section: {
    background: "#fff",
    borderRadius: "10px",
    padding: "1rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    marginBottom: "1rem",
  },
  sectionTitle: { fontSize: "0.95rem", marginBottom: "0.4rem" },
  status: { fontSize: "0.8rem", marginBottom: "0.8rem", fontWeight: 600 },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.85rem", color: "#333" },
  toggleRow: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.9rem" },
  message: { color: "#16a34a", fontSize: "0.85rem", margin: 0 },
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
  downloadBox: { marginTop: "1.2rem", paddingTop: "1rem", borderTop: "1px solid #f0f0f0" },
  downloadButton: {
    display: "inline-block",
    padding: "0.55rem 1rem",
    borderRadius: "6px",
    border: "1px solid #2563eb",
    color: "#2563eb",
    fontSize: "0.85rem",
    textDecoration: "none",
  },
  stepList: { fontSize: "0.8rem", color: "#555", margin: "0.8rem 0 0 0", paddingLeft: "1.2rem", lineHeight: 1.7 },
};
