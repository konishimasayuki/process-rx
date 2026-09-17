import { useEffect, useState } from "react";

export default function DestinationsList() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    facility_name: "",
    name: "",
    address: "",
    notes: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/destinations");
    const data = await res.json();
    setDestinations(data.destinations || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setForm({ facility_name: "", name: "", address: "", notes: "" });
    setEditingId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name || !form.address) {
      setError("氏名と住所は必須です");
      return;
    }

    setSaving(true);
    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { ...form, id: editingId } : form;

    const res = await fetch("/api/destinations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "保存に失敗しました");
      setSaving(false);
      return;
    }

    resetForm();
    setSaving(false);
    load();
  }

  function startEdit(dest) {
    setEditingId(dest.id);
    setForm({
      facility_name: dest.facility_name || "",
      name: dest.name || "",
      address: dest.address || "",
      notes: dest.notes || "",
    });
  }

  async function handleDelete(id) {
    if (!confirm("この配達先を削除しますか？")) return;
    await fetch("/api/destinations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>配達先一覧</h2>

      <form style={styles.form} onSubmit={handleSubmit}>
        <input
          style={styles.input}
          placeholder="施設名(任意)"
          value={form.facility_name}
          onChange={(e) => setForm({ ...form, facility_name: e.target.value })}
        />
        <input
          style={styles.input}
          placeholder="氏名"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={styles.input}
          placeholder="住所"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <input
          style={styles.input}
          placeholder="備考(任意)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.formButtons}>
          <button style={styles.button} type="submit" disabled={saving}>
            {editingId ? "更新" : "追加"}
          </button>
          {editingId && (
            <button
              style={styles.secondaryButton}
              type="button"
              onClick={resetForm}
            >
              キャンセル
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p>読み込み中...</p>
      ) : destinations.length === 0 ? (
        <p style={styles.muted}>配達先がまだ登録されていません</p>
      ) : (
        <ul style={styles.list}>
          {destinations.map((dest) => (
            <li key={dest.id} style={styles.listItem}>
              <div>
                {dest.facility_name && (
                  <div style={styles.facility}>{dest.facility_name}</div>
                )}
                <div style={styles.destName}>{dest.name} 様</div>
                <div style={styles.address}>
                  {dest.address}
                  {dest.lat == null && (
                    <span style={styles.geoWarning}>（位置情報未取得）</span>
                  )}
                </div>
                {dest.notes && <div style={styles.notes}>{dest.notes}</div>}
              </div>
              <div style={styles.itemButtons}>
                <button style={styles.smallButton} onClick={() => startEdit(dest)}>
                  編集
                </button>
                <button
                  style={styles.smallDangerButton}
                  onClick={() => handleDelete(dest.id)}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "480px", margin: "0 auto" },
  heading: { fontSize: "1.2rem", marginBottom: "1rem" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginBottom: "1.5rem",
    background: "#fff",
    padding: "1rem",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  formButtons: { display: "flex", gap: "0.5rem" },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  muted: { color: "#888" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" },
  listItem: {
    background: "#fff",
    padding: "0.8rem 1rem",
    borderRadius: "8px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "0.5rem",
  },
  facility: { fontSize: "0.75rem", color: "#2563eb", fontWeight: 600 },
  destName: { fontSize: "1rem", fontWeight: 600 },
  address: { fontSize: "0.85rem", color: "#555" },
  notes: { fontSize: "0.8rem", color: "#888", marginTop: "0.2rem" },
  geoWarning: { color: "#d97706", fontSize: "0.75rem", marginLeft: "0.4rem" },
  itemButtons: { display: "flex", flexDirection: "column", gap: "0.3rem" },
  smallButton: {
    padding: "0.3rem 0.6rem",
    fontSize: "0.75rem",
    borderRadius: "5px",
    border: "1px solid #ccc",
    background: "#fff",
    cursor: "pointer",
  },
  smallDangerButton: {
    padding: "0.3rem 0.6rem",
    fontSize: "0.75rem",
    borderRadius: "5px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    cursor: "pointer",
  },
};
