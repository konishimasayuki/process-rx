import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";

const ROLE_LABELS = { admin: "管理者", staff: "スタッフ" };
const EMPTY_FORM = { name: "", login_id: "", password: "", role: "staff", active: true };

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/employees");
    const data = await res.json().catch(() => ({}));
    setEmployees(data.employees || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEdit(e) {
    setEditingId(e.id);
    setForm({ name: e.name, login_id: e.login_id, password: "", role: e.role, active: e.active });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(ev) {
    ev.preventDefault();
    setError("");
    if (!form.name.trim() || !form.login_id.trim()) {
      setError("氏名とログインIDは必須です");
      return;
    }
    if (!editingId && !form.password) {
      setError("パスワードを入力してください");
      return;
    }
    setSaving(true);
    const body = editingId ? { ...form, id: editingId } : form;
    if (editingId && !form.password) delete body.password;
    const res = await fetch("/api/employees", {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "保存に失敗しました");
      return;
    }
    setEmployees((prev) => {
      const others = prev.filter((x) => x.id !== data.employee.id);
      return [...others, data.employee].sort((a, b) =>
        (a.created_at || "").localeCompare(b.created_at || "")
      );
    });
    setModalOpen(false);
  }

  async function handleDelete() {
    if (!confirm(`「${form.name}」を削除しますか？`)) return;
    await fetch("/api/employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId }),
    });
    setEmployees((prev) => prev.filter((x) => x.id !== editingId));
    setModalOpen(false);
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>従業員一覧</h2>
      <p style={styles.help}>
        ここで登録したログインID・パスワードで process-rx にログインできます。今後スマホアプリのタイムカードにも使います。
      </p>

      {loading ? (
        <p>読み込み中...</p>
      ) : employees.length === 0 ? (
        <p style={styles.muted}>まだ従業員が登録されていません。右下の＋から追加してください。</p>
      ) : (
        <div style={styles.list}>
          <div style={styles.headerGrid}>
            <span>氏名</span>
            <span>ログインID</span>
            <span>権限</span>
            <span>状態</span>
          </div>
          {employees.map((e) => (
            <button key={e.id} style={styles.row} onClick={() => openEdit(e)}>
              <span style={styles.name}>{e.name}</span>
              <span style={styles.loginId}>{e.login_id}</span>
              <span>{ROLE_LABELS[e.role] || e.role}</span>
              <span style={{ color: e.active ? "#047857" : "#999" }}>
                {e.active ? "有効" : "無効"}
              </span>
            </button>
          ))}
        </div>
      )}

      <FloatingAddButton onClick={openAdd} />

      {modalOpen && (
        <Modal title={editingId ? "従業員を編集" : "従業員を追加"} onClose={() => setModalOpen(false)}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <label style={styles.label}>
              氏名
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label style={styles.label}>
              ログインID(半角英数字)
              <input
                style={styles.input}
                value={form.login_id}
                autoCapitalize="none"
                onChange={(e) => setForm({ ...form, login_id: e.target.value.trim() })}
              />
            </label>
            <label style={styles.label}>
              {editingId ? "パスワード(変更するときだけ入力)" : "パスワード(4文字以上)"}
              <input
                style={styles.input}
                type="text"
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label style={styles.label}>
              権限
              <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">スタッフ</option>
                <option value="admin">管理者</option>
              </select>
            </label>
            {editingId && (
              <label style={styles.toggleRow}>
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                有効(オフにするとログインできなくなります)
              </label>
            )}

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.formButtons}>
              <button style={styles.button} type="submit" disabled={saving}>
                {editingId ? "更新" : "追加"}
              </button>
              {editingId && (
                <button type="button" style={styles.dangerButton} onClick={handleDelete}>
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

const COLUMNS = "1.4fr 1.2fr 0.8fr 0.6fr";

const styles = {
  container: { padding: "1rem", maxWidth: "720px" },
  heading: { fontSize: "1.2rem", marginBottom: "0.4rem" },
  help: { fontSize: "0.8rem", color: "#888", margin: "0 0 0.8rem 0" },
  muted: { color: "#888" },
  list: { background: "#fff", borderRadius: "10px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflow: "hidden" },
  headerGrid: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "0.6rem",
    padding: "0.5rem 1rem",
    background: "#f9fafb",
    borderBottom: "2px solid #e5e7eb",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#666",
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "0.6rem",
    alignItems: "center",
    width: "100%",
    padding: "0.7rem 1rem",
    background: "none",
    border: "none",
    borderBottom: "1px solid #f3f4f6",
    textAlign: "left",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  name: { fontWeight: 700 },
  loginId: { color: "#555", fontFamily: "monospace" },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem", color: "#555" },
  toggleRow: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  formButtons: { display: "flex", gap: "0.5rem" },
  button: { padding: "0.6rem 1.2rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.95rem", cursor: "pointer" },
  dangerButton: { padding: "0.6rem 1.2rem", borderRadius: "6px", border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: "0.95rem", cursor: "pointer" },
};
