import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";

const ROLE_LABELS = { admin: "管理者", staff: "スタッフ" };
const EMPTY_FORM = {
  name: "",
  login_id: "",
  password: "",
  role: "staff",
  active: true,
  is_driver: false,
  line_id: "",
  pay_type: "hourly",
  hourly_wage: "",
  monthly_salary: "",
  standard_hours: 160,
  commute_type: "none",
  commute_amount: "",
};

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [legacyDrivers, setLegacyDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [res, dres] = await Promise.all([fetch("/api/employees"), fetch("/api/drivers")]);
    const data = await res.json().catch(() => ({}));
    const ddata = await dres.json().catch(() => ({}));
    setEmployees(data.employees || []);
    setLegacyDrivers((ddata.drivers || []).filter((d) => d.source === "legacy").map((d) => d.name));
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
    setForm({ ...EMPTY_FORM, ...e, password: "" });
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
    const body = editingId ? { ...form, id: editingId } : { ...form };
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
      return [...others, data.employee].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    });
    setLegacyDrivers((prev) => prev.filter((n) => n !== data.employee.name || !data.employee.is_driver));
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

  async function removeLegacy(name) {
    if (!confirm(`以前のドライバー登録「${name}」を消しますか？`)) return;
    await fetch("/api/drivers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setLegacyDrivers((prev) => prev.filter((n) => n !== name));
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>従業員一覧</h2>
      <p style={styles.help}>
        ここで登録したログインID・パスワードでログインすると、スマホ用の画面(タイムカード付き)になります。「ドライバー」にチェックした人が配達ボードのドライバーになります。
      </p>

      {legacyDrivers.length > 0 && (
        <div style={styles.legacy}>
          以前の設定画面で登録したドライバーが残っています。同じ名前で従業員登録し「ドライバー」にチェックすると引き継がれます。
          <div style={styles.legacyList}>
            {legacyDrivers.map((n) => (
              <span key={n} style={styles.legacyChip}>
                {n}
                <button style={styles.legacyRemove} onClick={() => removeLegacy(n)}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p>読み込み中...</p>
      ) : employees.length === 0 ? (
        <p style={styles.muted}>まだ従業員が登録されていません。右下の＋から追加してください。</p>
      ) : (
        <div style={styles.list}>
          <div style={styles.headerGrid}>
            <span>氏名</span>
            <span>ログインID</span>
            <span>区分</span>
            <span>権限</span>
            <span>状態</span>
          </div>
          {employees.map((e) => (
            <button key={e.id} style={styles.row} onClick={() => openEdit(e)}>
              <span style={styles.name}>{e.name}</span>
              <span style={styles.loginId}>{e.login_id}</span>
              <span style={{ color: e.is_driver ? "#2563eb" : "#555" }}>{e.is_driver ? "ドライバー" : "内勤"}</span>
              <span>{ROLE_LABELS[e.role] || e.role}</span>
              <span style={{ color: e.active ? "#047857" : "#999" }}>{e.active ? "有効" : "無効"}</span>
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
              <input style={styles.input} value={form.name} onChange={set("name")} />
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
              <input style={styles.input} type="text" value={form.password} autoComplete="new-password" onChange={set("password")} />
            </label>
            <label style={styles.label}>
              権限
              <select style={styles.input} value={form.role} onChange={set("role")}>
                <option value="staff">スタッフ</option>
                <option value="admin">管理者(給料明細・従業員管理ができる)</option>
              </select>
            </label>
            <label style={styles.checkRow}>
              <input type="checkbox" checked={form.is_driver} onChange={set("is_driver")} />
              ドライバー(チェックなしは内勤)
            </label>
            <label style={styles.label}>
              LINE ID(配達ルートの送信先・設定画面の友達追加履歴からコピー)
              <input style={styles.input} value={form.line_id} placeholder="U1234..." onChange={set("line_id")} />
            </label>

            <div style={styles.section}>給与の設定</div>
            <label style={styles.label}>
              給与形態
              <select style={styles.input} value={form.pay_type} onChange={set("pay_type")}>
                <option value="hourly">時給</option>
                <option value="monthly">月給</option>
              </select>
            </label>
            {form.pay_type === "hourly" ? (
              <label style={styles.label}>
                時給(円)
                <input style={styles.input} inputMode="numeric" value={form.hourly_wage} onChange={set("hourly_wage")} />
              </label>
            ) : (
              <>
                <label style={styles.label}>
                  月給(円)
                  <input style={styles.input} inputMode="numeric" value={form.monthly_salary} onChange={set("monthly_salary")} />
                </label>
                <label style={styles.label}>
                  月の所定労働時間(残業単価の計算用)
                  <input style={styles.input} inputMode="numeric" value={form.standard_hours} onChange={set("standard_hours")} />
                </label>
              </>
            )}
            <label style={styles.label}>
              通勤手当
              <select style={styles.input} value={form.commute_type} onChange={set("commute_type")}>
                <option value="none">なし</option>
                <option value="daily">1日あたり</option>
                <option value="monthly">月額</option>
              </select>
            </label>
            {form.commute_type !== "none" && (
              <label style={styles.label}>
                通勤手当の金額(円)
                <input style={styles.input} inputMode="numeric" value={form.commute_amount} onChange={set("commute_amount")} />
              </label>
            )}

            {editingId && (
              <label style={styles.checkRow}>
                <input type="checkbox" checked={form.active} onChange={set("active")} />
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

const COLUMNS = "1.4fr 1.1fr 0.9fr 0.8fr 0.6fr";

const styles = {
  container: { padding: "1rem", maxWidth: "760px" },
  heading: { fontSize: "1.2rem", marginBottom: "0.4rem" },
  help: { fontSize: "0.8rem", color: "#888", margin: "0 0 0.8rem 0", lineHeight: 1.6 },
  muted: { color: "#888" },
  legacy: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "0.7rem", fontSize: "0.8rem", color: "#92400e", marginBottom: "0.8rem" },
  legacyList: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem" },
  legacyChip: { display: "inline-flex", alignItems: "center", gap: "0.2rem", background: "#fff", border: "1px solid #fde68a", borderRadius: "999px", padding: "0.15rem 0.5rem" },
  legacyRemove: { border: "none", background: "none", color: "#dc2626", cursor: "pointer" },
  list: { background: "#fff", borderRadius: "10px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflowX: "auto" },
  headerGrid: { display: "grid", gridTemplateColumns: COLUMNS, gap: "0.6rem", padding: "0.5rem 1rem", background: "#f9fafb", borderBottom: "2px solid #e5e7eb", fontSize: "0.75rem", fontWeight: 700, color: "#666", minWidth: "520px" },
  row: { display: "grid", gridTemplateColumns: COLUMNS, gap: "0.6rem", alignItems: "center", width: "100%", minWidth: "520px", padding: "0.7rem 1rem", background: "none", border: "none", borderBottom: "1px solid #f3f4f6", textAlign: "left", fontSize: "0.85rem", cursor: "pointer" },
  name: { fontWeight: 700 },
  loginId: { color: "#555", fontFamily: "monospace" },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  section: { fontWeight: 700, fontSize: "0.9rem", borderBottom: "1px solid #eee", paddingBottom: "0.2rem", marginTop: "0.4rem" },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem", color: "#555" },
  checkRow: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  formButtons: { display: "flex", gap: "0.5rem" },
  button: { padding: "0.6rem 1.2rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.95rem", cursor: "pointer" },
  dangerButton: { padding: "0.6rem 1.2rem", borderRadius: "6px", border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: "0.95rem", cursor: "pointer" },
};
