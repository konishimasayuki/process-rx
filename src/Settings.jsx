import { useEffect, useState } from "react";

export default function Settings() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newDriver, setNewDriver] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/drivers");
    const data = await res.json();
    setDrivers(data.drivers || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    const trimmed = newDriver.trim();
    if (!trimmed) {
      setError("ドライバー名を入力してください");
      return;
    }
    if (drivers.includes(trimmed)) {
      setError("すでに登録されています");
      return;
    }

    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登録に失敗しました");
      return;
    }

    setDrivers((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b, "ja")));
    setNewDriver("");
  }

  async function handleRemove(name) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await fetch("/api/drivers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setDrivers((prev) => prev.filter((d) => d !== name));
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>設定</h2>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>ドライバー登録</h3>

        <form style={styles.form} onSubmit={handleAdd}>
          <input
            style={styles.input}
            placeholder="ドライバー名"
            value={newDriver}
            onChange={(e) => setNewDriver(e.target.value)}
          />
          <button style={styles.button} type="submit">
            追加
          </button>
        </form>

        {error && <p style={styles.error}>{error}</p>}

        {loading ? (
          <p>読み込み中...</p>
        ) : drivers.length === 0 ? (
          <p style={styles.muted}>まだドライバーが登録されていません</p>
        ) : (
          <ul style={styles.list}>
            {drivers.map((name) => (
              <li key={name} style={styles.listItem}>
                <span>{name}</span>
                <button
                  style={styles.removeButton}
                  onClick={() => handleRemove(name)}
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
  container: { padding: "1rem", maxWidth: "480px" },
  heading: { fontSize: "1.2rem", marginBottom: "1rem" },
  section: {
    background: "#fff",
    borderRadius: "10px",
    padding: "1rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  sectionTitle: { fontSize: "0.95rem", marginBottom: "0.6rem" },
  form: { display: "flex", gap: "0.5rem", marginBottom: "0.6rem" },
  input: {
    flex: 1,
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
  },
  button: {
    padding: "0.6rem 1rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: "0 0 0.5rem 0" },
  muted: { color: "#888", fontSize: "0.85rem" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  listItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 0",
    borderBottom: "1px solid #f0f0f0",
    fontSize: "0.9rem",
  },
  removeButton: {
    fontSize: "0.75rem",
    padding: "0.25rem 0.6rem",
    borderRadius: "5px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    cursor: "pointer",
  },
};
