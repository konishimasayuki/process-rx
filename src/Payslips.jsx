import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { jstMonth, minToHM, monthLabel, shiftMonth, yen } from "./timeUtils.js";

const STATUS = {
  none: { label: "未作成", color: "#9ca3af" },
  draft: { label: "下書き", color: "#d97706" },
  final: { label: "確定", color: "#047857" },
};

function totals(p) {
  const gross = p.earnings.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const ded = p.deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  return { gross, ded, net: gross - ded };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function printPayslip(p) {
  const t = totals(p);
  const rows = (list) =>
    list.filter((x) => Number(x.amount)).map((x) => `<tr><td>${escapeHtml(x.label)}</td><td class="n">${yen(x.amount)}</td></tr>`).join("") ||
    `<tr><td colspan="2" class="muted">なし</td></tr>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>給与明細 ${escapeHtml(p.employee_name)} ${monthLabel(p.month)}</title>
<style>
body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;padding:32px;color:#111;max-width:720px;margin:auto}
h1{text-align:center;letter-spacing:.4em;font-size:22px;margin:0 0 4px}
.sub{text-align:center;color:#555;margin-bottom:24px}
.name{font-size:18px;border-bottom:1px solid #111;display:inline-block;padding:0 24px 2px 4px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th,td{border:1px solid #999;padding:6px 10px;font-size:13px}
th{background:#f3f4f6;text-align:left}
.n{text-align:right}
.muted{color:#999;text-align:center}
.grid{display:flex;gap:16px}.grid>div{flex:1}
.net{font-size:20px;font-weight:bold;text-align:right;border:2px solid #111;padding:10px 14px}
.note{font-size:12px;color:#444;white-space:pre-wrap}
@media print{body{padding:0}}
</style></head><body>
<h1>給与明細書</h1>
<div class="sub">${monthLabel(p.month)}分</div>
<div class="name">${escapeHtml(p.employee_name)} 様</div>
<table><tr><th>出勤日数</th><th>実働時間</th><th>残業時間</th><th>深夜時間</th></tr>
<tr><td class="n">${p.attendance.days || 0}日</td><td class="n">${minToHM(p.attendance.work_min)}</td><td class="n">${minToHM(p.attendance.overtime_min)}</td><td class="n">${minToHM(p.attendance.night_min)}</td></tr></table>
<div class="grid">
<div><table><tr><th colspan="2">支給</th></tr>${rows(p.earnings)}<tr><th>総支給額</th><th class="n">${yen(t.gross)}</th></tr></table></div>
<div><table><tr><th colspan="2">控除</th></tr>${rows(p.deductions)}<tr><th>控除合計</th><th class="n">${yen(t.ded)}</th></tr></table></div>
</div>
<div class="net">差引支給額 ${yen(t.net)}</div>
${p.note ? `<p class="note">${escapeHtml(p.note)}</p>` : ""}
<script>window.onload=()=>window.print()</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return alert("ポップアップがブロックされました。許可してからもう一度押してください");
  w.document.write(html);
  w.document.close();
}

// 管理者用: 給料明細の作成
export default function Payslips() {
  const [month, setMonth] = useState(jstMonth());
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState("");

  async function loadRows() {
    const res = await fetch(`/api/payslips?month=${month}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setRows(json.rows || []);
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function open(row) {
    setMessage("");
    const res = await fetch(`/api/payslips?month=${month}&employee_id=${row.employee_id}`);
    const json = await res.json();
    setDraft(json.draft);
    setEditing(json.saved || json.draft);
  }

  function setAmount(listKey, key, value) {
    setEditing({
      ...editing,
      [listKey]: editing[listKey].map((x) => (x.key === key ? { ...x, amount: value.replace(/[^0-9]/g, "") } : x)),
    });
  }

  function recalc() {
    // 勤怠から計算できる項目(基本給・残業・深夜・通勤)だけ置き換え、手入力の控除は残す
    const auto = Object.fromEntries(draft.earnings.map((e) => [e.key, e.amount]));
    setEditing({
      ...editing,
      attendance: draft.attendance,
      hourly_rate: draft.hourly_rate,
      earnings: editing.earnings.map((e) => (e.key === "other" ? e : { ...e, amount: auto[e.key] })),
    });
    setMessage("勤怠から再計算しました(控除・その他手当はそのまま)");
  }

  async function save(status) {
    const res = await fetch("/api/payslips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editing, month, status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(json.error || "保存に失敗しました");
    setEditing(json.payslip);
    setMessage(status === "final" ? "確定しました" : "下書き保存しました");
    loadRows();
  }

  const t = editing ? totals(editing) : null;

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>給料明細</h2>
      <div style={styles.monthBar}>
        <button style={styles.nav} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong>{monthLabel(month)}分</strong>
        <button style={styles.nav} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>

      <div style={styles.list}>
        <div style={styles.head}>
          <span>氏名</span><span>出勤</span><span>実働</span><span>状態</span><span>差引支給額</span>
        </div>
        {rows.map((r) => (
          <button key={r.employee_id} style={styles.row} onClick={() => open(r)}>
            <strong>{r.name}</strong>
            <span>{r.attendance.days}日</span>
            <span>{minToHM(r.attendance.work_min)}</span>
            <span style={{ color: STATUS[r.status].color, fontWeight: 700 }}>{STATUS[r.status].label}</span>
            <span>{r.net != null ? yen(r.net) : "—"}</span>
          </button>
        ))}
        {rows.length === 0 && <p style={styles.muted}>従業員がいません</p>}
      </div>
      <p style={styles.help}>
        行をタップすると明細を作れます。基本給・残業・深夜・通勤は勤怠と従業員一覧の給与設定から自動計算します。社会保険・税金は金額を入力してください。
      </p>

      {editing && (
        <Modal title={`${editing.employee_name}さん ${monthLabel(month)}分`} onClose={() => setEditing(null)}>
          <div style={styles.form}>
            <div style={styles.info}>
              出勤 {editing.attendance.days || 0}日 / 実働 {minToHM(editing.attendance.work_min)} / 残業{" "}
              {minToHM(editing.attendance.overtime_min)} / 深夜 {minToHM(editing.attendance.night_min)}
              {editing.hourly_rate ? ` / 時間単価 ${yen(editing.hourly_rate)}` : ""}
            </div>
            <button style={styles.subButton} onClick={recalc}>勤怠から再計算</button>

            <div style={styles.section}>支給</div>
            {editing.earnings.map((e) => (
              <label key={e.key} style={styles.line}>
                <span>{e.label}</span>
                <input style={styles.amount} inputMode="numeric" value={e.amount} onChange={(ev) => setAmount("earnings", e.key, ev.target.value)} />
              </label>
            ))}
            <div style={styles.sum}>総支給額 {yen(t.gross)}</div>

            <div style={styles.section}>控除</div>
            {editing.deductions.map((d) => (
              <label key={d.key} style={styles.line}>
                <span>{d.label}</span>
                <input style={styles.amount} inputMode="numeric" value={d.amount} onChange={(ev) => setAmount("deductions", d.key, ev.target.value)} />
              </label>
            ))}
            <div style={styles.sum}>控除合計 {yen(t.ded)}</div>
            <div style={styles.net}>差引支給額 {yen(t.net)}</div>

            <textarea
              style={styles.note}
              rows={2}
              placeholder="備考(明細に印刷されます)"
              value={editing.note || ""}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
            {message && <p style={styles.message}>{message}</p>}
            <div style={styles.buttons}>
              <button style={styles.subButton} onClick={() => save("draft")}>下書き保存</button>
              <button style={styles.primary} onClick={() => save("final")}>確定</button>
              <button style={styles.subButton} onClick={() => printPayslip({ ...editing, month })}>印刷</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const cols = "1.4fr 0.6fr 0.7fr 0.7fr 1fr";
const styles = {
  container: { padding: "1rem", maxWidth: "820px" },
  heading: { fontSize: "1.2rem", marginBottom: "0.6rem" },
  monthBar: { display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.8rem" },
  nav: { width: "2.2rem", height: "2.2rem", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", fontSize: "1.1rem", cursor: "pointer" },
  list: { background: "#fff", borderRadius: "10px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflow: "hidden" },
  head: { display: "grid", gridTemplateColumns: cols, gap: "0.5rem", padding: "0.5rem 1rem", background: "#f9fafb", fontSize: "0.75rem", fontWeight: 700, color: "#666", borderBottom: "2px solid #e5e7eb" },
  row: { display: "grid", gridTemplateColumns: cols, gap: "0.5rem", width: "100%", padding: "0.7rem 1rem", border: "none", borderBottom: "1px solid #f3f4f6", background: "none", textAlign: "left", fontSize: "0.85rem", cursor: "pointer" },
  muted: { color: "#888", padding: "0.8rem 1rem" },
  help: { fontSize: "0.8rem", color: "#888", marginTop: "0.6rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.45rem" },
  info: { background: "#f9fafb", borderRadius: "8px", padding: "0.6rem", fontSize: "0.8rem", color: "#555" },
  section: { fontWeight: 700, fontSize: "0.9rem", marginTop: "0.5rem", borderBottom: "1px solid #eee", paddingBottom: "0.2rem" },
  line: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.88rem" },
  amount: { width: "8rem", padding: "0.4rem", borderRadius: "6px", border: "1px solid #ccc", textAlign: "right", fontSize: "0.95rem" },
  sum: { textAlign: "right", fontSize: "0.85rem", color: "#555" },
  net: { textAlign: "right", fontSize: "1.15rem", fontWeight: 700, borderTop: "2px solid #111", paddingTop: "0.4rem", marginTop: "0.3rem" },
  note: { padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.9rem" },
  message: { color: "#16a34a", fontSize: "0.85rem", margin: 0 },
  buttons: { display: "flex", gap: "0.5rem" },
  subButton: { padding: "0.55rem 0.9rem", borderRadius: "6px", border: "1px solid #ccc", background: "#fff", fontSize: "0.85rem", cursor: "pointer" },
  primary: { flex: 1, padding: "0.55rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.9rem", cursor: "pointer" },
};
