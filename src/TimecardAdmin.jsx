import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { PUNCH_LABELS, dayLabel, daysOfMonth, hm, jstMonth, minToHM, monthLabel, shiftMonth } from "./timeUtils.js";

// 管理者用: 全員の月の勤怠と、打刻の修正
export default function TimecardAdmin() {
  const [month, setMonth] = useState(jstMonth());
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null); // {employee_id, name}
  const [detail, setDetail] = useState(null);
  const [editDay, setEditDay] = useState(null);
  const [error, setError] = useState("");

  async function loadRows() {
    const res = await fetch(`/api/payslips?month=${month}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setRows(json.rows || []);
    else setError(json.error || "読み込みに失敗しました");
  }

  async function loadDetail(emp = selected) {
    if (!emp) return;
    const res = await fetch(`/api/timecard?month=${month}&employee_id=${emp.employee_id}`);
    if (res.ok) setDetail(await res.json());
  }

  useEffect(() => {
    loadRows();
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function openEmployee(row) {
    setSelected(row);
    setDetail(null);
    loadDetail(row);
  }

  function openEdit(date) {
    const day = detail?.days.find((d) => d.date === date);
    setError("");
    setEditDay({
      date,
      events: (day?.events || []).map((e) => ({ type: e.type, time: hm(e.at), reason: e.reason || "" })),
    });
  }

  async function saveDay() {
    const res = await fetch("/api/timecard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: selected.employee_id, date: editDay.date, events: editDay.events }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "保存に失敗しました");
    setEditDay(null);
    loadDetail();
    loadRows();
  }

  const byDate = Object.fromEntries((detail?.days || []).map((d) => [d.date, d]));

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>タイムカード管理</h2>
      <div style={styles.monthBar}>
        <button style={styles.nav} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button style={styles.nav} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>

      <div style={styles.list}>
        <div style={styles.head}>
          <span>氏名</span><span>出勤日数</span><span>実働</span><span>残業</span><span>深夜</span>
        </div>
        {rows.map((r) => (
          <button
            key={r.employee_id}
            style={{ ...styles.row, background: selected?.employee_id === r.employee_id ? "#eff6ff" : "none" }}
            onClick={() => openEmployee(r)}
          >
            <strong>{r.name}</strong>
            <span>{r.attendance.days}日</span>
            <span>{minToHM(r.attendance.work_min)}</span>
            <span>{minToHM(r.attendance.overtime_min)}</span>
            <span>{minToHM(r.attendance.night_min)}</span>
          </button>
        ))}
        {rows.length === 0 && <p style={styles.muted}>従業員がいません</p>}
      </div>

      {selected && (
        <div style={styles.detail}>
          <h3 style={styles.subHeading}>{selected.name}さん {monthLabel(month)}(日付をタップで修正)</h3>
          <div style={styles.list}>
            {daysOfMonth(month).map((date) => {
              const d = byDate[date];
              return (
                <button key={date} style={styles.dayRow} onClick={() => openEdit(date)}>
                  <span style={styles.dayDate}>{dayLabel(date)}</span>
                  <span style={styles.dayEvents}>
                    {d
                      ? d.events.map((e, i) => (
                          <span key={i} style={e.reason ? styles.evReason : styles.ev}>
                            {PUNCH_LABELS[e.type]} {hm(e.at)}
                            {e.reason && `(${e.reason})`}
                          </span>
                        ))
                      : <span style={styles.empty}>—</span>}
                  </span>
                  <span style={styles.dayWork}>{d ? minToHM(d.summary.work_min) : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editDay && (
        <Modal title={`${selected.name}さん ${dayLabel(editDay.date)}の打刻`} onClose={() => setEditDay(null)}>
          <div style={styles.form}>
            {editDay.events.map((ev, i) => (
              <div key={i} style={styles.evEdit}>
                <select
                  style={styles.input}
                  value={ev.type}
                  onChange={(e) => {
                    const events = [...editDay.events];
                    events[i] = { ...ev, type: e.target.value };
                    setEditDay({ ...editDay, events });
                  }}
                >
                  {Object.entries(PUNCH_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <input
                  style={styles.input}
                  type="time"
                  value={ev.time}
                  onChange={(e) => {
                    const events = [...editDay.events];
                    events[i] = { ...ev, time: e.target.value };
                    setEditDay({ ...editDay, events });
                  }}
                />
                <input
                  style={{ ...styles.input, flex: 1 }}
                  placeholder="理由"
                  value={ev.reason}
                  onChange={(e) => {
                    const events = [...editDay.events];
                    events[i] = { ...ev, reason: e.target.value };
                    setEditDay({ ...editDay, events });
                  }}
                />
                <button
                  style={styles.remove}
                  onClick={() => setEditDay({ ...editDay, events: editDay.events.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              style={styles.add}
              onClick={() => {
                const last = editDay.events[editDay.events.length - 1];
                const next = !last ? "clock_in" : last.type === "clock_in" || last.type === "back" ? "clock_out" : "clock_in";
                setEditDay({ ...editDay, events: [...editDay.events, { type: next, time: "09:00", reason: "" }] });
              }}
            >
              ＋ 打刻を追加
            </button>
            <p style={styles.note}>時刻の順に並べてください。前より早い時刻は翌日(夜勤)として扱います。</p>
            {error && <p style={styles.error}>{error}</p>}
            <button style={styles.save} onClick={saveDay}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const cols = "1.4fr 0.8fr 0.8fr 0.8fr 0.8fr";
const styles = {
  container: { padding: "1rem", maxWidth: "820px" },
  heading: { fontSize: "1.2rem", marginBottom: "0.6rem" },
  subHeading: { fontSize: "1rem", margin: "1.2rem 0 0.5rem" },
  monthBar: { display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.8rem" },
  nav: { width: "2.2rem", height: "2.2rem", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", fontSize: "1.1rem", cursor: "pointer" },
  list: { background: "#fff", borderRadius: "10px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", overflow: "hidden" },
  head: { display: "grid", gridTemplateColumns: cols, gap: "0.5rem", padding: "0.5rem 1rem", background: "#f9fafb", fontSize: "0.75rem", fontWeight: 700, color: "#666", borderBottom: "2px solid #e5e7eb" },
  row: { display: "grid", gridTemplateColumns: cols, gap: "0.5rem", width: "100%", padding: "0.65rem 1rem", border: "none", borderBottom: "1px solid #f3f4f6", textAlign: "left", fontSize: "0.85rem", cursor: "pointer" },
  muted: { color: "#888", padding: "0.8rem 1rem" },
  detail: {},
  dayRow: { display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", padding: "0.5rem 1rem", border: "none", borderBottom: "1px solid #f3f4f6", background: "none", textAlign: "left", fontSize: "0.82rem", cursor: "pointer" },
  dayDate: { width: "4.6rem", flexShrink: 0, color: "#555" },
  dayEvents: { flex: 1, display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  ev: { background: "#f3f4f6", borderRadius: "4px", padding: "0.1rem 0.35rem" },
  evReason: { background: "#fff7ed", color: "#c2410c", borderRadius: "4px", padding: "0.1rem 0.35rem" },
  empty: { color: "#ccc" },
  dayWork: { fontWeight: 700, width: "3rem", textAlign: "right" },
  form: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  evEdit: { display: "flex", gap: "0.4rem", alignItems: "center" },
  input: { padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.9rem", minWidth: 0 },
  remove: { border: "none", background: "none", color: "#dc2626", fontSize: "1.1rem", cursor: "pointer" },
  add: { padding: "0.5rem", borderRadius: "6px", border: "1px dashed #2563eb", background: "#fff", color: "#2563eb", cursor: "pointer" },
  note: { fontSize: "0.75rem", color: "#888", margin: 0 },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  save: { padding: "0.6rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.95rem", cursor: "pointer" },
};
