import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";

const EMPTY_FORM = { facility_name: "", name: "", address: "", notes: "" };

export default function DestinationsList() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) =>
      [d.facility_name, d.name, d.address, d.notes]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [destinations, search]);

  function openAddModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEditModal(dest) {
    setEditingId(dest.id);
    setForm({
      facility_name: dest.facility_name || "",
      name: dest.name || "",
      address: dest.address || "",
      notes: dest.notes || "",
    });
    setError("");
    setModalOpen(true);
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

    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function handleDelete(id) {
    if (!confirm("この配達先を削除しますか？")) return;
    await fetch("/api/destinations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setModalOpen(false);
    load();
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>配達先一覧</h2>

      <input
        style={styles.search}
        placeholder="施設名・氏名・住所・備考で検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p>読み込み中...</p>
      ) : filtered.length === 0 ? (
        <p style={styles.muted}>該当する配達先がありません</p>
      ) : (
        <div style={styles.list}>
          {filtered.map((dest) => (
            <button
              key={dest.id}
              style={styles.row}
              onClick={() => openEditModal(dest)}
            >
              <span style={styles.rowFacility}>{dest.facility_name || "—"}</span>
              <span style={styles.rowName}>{dest.name}様</span>
              <span style={styles.rowAddress}>{dest.address}</span>
              <span style={styles.rowNotes}>{dest.notes}</span>
              {dest.lat == null && <span style={styles.geoWarning}>位置未取得</span>}
            </button>
          ))}
        </div>
      )}

      <FloatingAddButton onClick={openAddModal} />

      {modalOpen && (
        <Modal
          title={editingId ? "配達先を編集" : "配達先を追加"}
          onClose={() => setModalOpen(false)}
        >
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
                  type="button"
                  style={styles.dangerButton}
                  onClick={() => handleDelete(editingId)}
                >
                  削除
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "100%" },
  heading: { fontSize: "1.2rem", marginBottom: "0.8rem" },
  search: {
    width: "100%",
    maxWidth: "480px",
    padding: "0.6rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
    marginBottom: "1rem",
    boxSizing: "border-box",
  },
  muted: { color: "#888" },
  list: {
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.8rem",
    padding: "0.6rem 1rem",
    borderBottom: "1px solid #f0f0f0",
    background: "none",
    border: "none",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "#f0f0f0",
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
    fontSize: "0.85rem",
    overflowX: "auto",
    whiteSpace: "nowrap",
  },
  rowFacility: { color: "#2563eb", flexShrink: 0, minWidth: "80px" },
  rowName: { fontWeight: 600, flexShrink: 0, minWidth: "90px" },
  rowAddress: { color: "#555", flex: 1, minWidth: "160px" },
  rowNotes: { color: "#999", flexShrink: 0, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" },
  geoWarning: { color: "#d97706", fontSize: "0.7rem", flexShrink: 0 },

  form: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  formButtons: { display: "flex", gap: "0.5rem", marginTop: "0.3rem" },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  dangerButton: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
};
