import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { PUNCH_LABELS, STATE_LABELS, dayLabel, hm, jstMonth, minToHM, monthLabel, shiftMonth } from "./timeUtils.js";

const BUTTONS = [
  { type: "clock_in", color: "#2563eb" },
  { type: "clock_out", color: "#dc2626" },
  { type: "out", color: "#d97706" },
  { type: "back", color: "#16a34a" },
];
const REASON_CHIPS = ["直行", "直帰", "外出先から", "在宅・その他"];

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export default function TimecardTab() {
  const [month, setMonth] = useState(jstMonth());
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [confirm, setConfirm] = useState(null); // 押す前の確認
  const [reasonAsk, setReasonAsk] = useState(null); // 範囲外の理由入力
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  async function load(m = month) {
    const res = await fetch(`/api/timecard?month=${m}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setData(json);
    else setError(json.error || "読み込みに失敗しました");
  }

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function send(type, position, reasonText) {
    const res = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...(position || {}), reason: reasonText || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(`${PUNCH_LABELS[type]}しました ${hm(json.event.at)}`);
      setReasonAsk(null);
      setReason("");
      await load(month);
      return;
    }
    if (json.need_reason) {
      setReasonAsk({ type, position, message: json.error });
      return;
    }
    setError(json.error || "打刻に失敗しました");
  }

  async function punch(type) {
    setConfirm(null);
    setError("");
    setBusy(type === "clock_in" || type === "clock_out" ? "位置情報を確認中…" : "送信中…");
    const position = await getPosition();
    await send(type, position);
    setBusy("");
  }

  async function submitReason() {
    if (!reason.trim()) return;
    setBusy("送信中…");
    await send(reasonAsk.type, reasonAsk.position, reason.trim());
    setBusy("");
  }

  const current = data?.current;
  const allowed = current?.allowed || [];
  const clock = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={styles.container}>
      <div style={styles.statusCard}>
        <div style={styles.clock}>{clock}</div>
        <div style={styles.dateLine}>
          {now.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}
        </div>
        {current && (
          <div style={{ ...styles.state, color: current.state === "off" ? "#666" : "#047857" }}>
            {STATE_LABELS[current.state]}
          </div>
        )}
      </div>

      <div style={styles.buttonGrid}>
        {BUTTONS.map((b) => {
          const enabled = allowed.includes(b.type) && !busy;
          return (
            <button
              key={b.type}
              disabled={!enabled}
              style={{
                ...styles.punchButton,
                background: enabled ? b.color : "#e5e7eb",
                color: enabled ? "#fff" : "#9ca3af",
              }}
              onClick={() => setConfirm(b.type)}
            >
              {PUNCH_LABELS[b.type]}
            </button>
          );
        })}
      </div>
      <p style={styles.locationNote}>📍 位置情報は、出勤・退勤のときに会社の近くかを確かめるためだけに使います。</p>
      {busy && <p style={styles.busy}>{busy}</p>}
      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.monthHeader}>
        <button style={styles.monthNav} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <span style={styles.monthTitle}>{monthLabel(month)}</span>
        <button style={styles.monthNav} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>

      {data && (
        <>
          <div style={styles.totals}>
            <div><span style={styles.totalNum}>{data.totals.days}</span>日<br /><small>出勤</small></div>
            <div><span style={styles.totalNum}>{minToHM(data.totals.work_min)}</span><br /><small>実働</small></div>
            <div><span style={styles.totalNum}>{minToHM(data.totals.overtime_min)}</span><br /><small>残業</small></div>
            <div><span style={styles.totalNum}>{minToHM(data.totals.night_min)}</span><br /><small>深夜</small></div>
          </div>

          {data.days.length === 0 ? (
            <p style={styles.muted}>この月の打刻はありません</p>
          ) : (
            <div style={styles.dayList}>
              {data.days.map((d) => (
                <div key={d.date} style={styles.dayRow}>
                  <span style={styles.dayDate}>{dayLabel(d.date)}</span>
                  <span style={styles.dayTimes}>
                    {hm(d.summary.first_in)} 〜 {d.summary.last_out ? hm(d.summary.last_out) : "勤務中"}
                    {d.summary.break_min > 0 && <small style={styles.small}> 外出{minToHM(d.summary.break_min)}</small>}
                    {d.events.filter((e) => e.reason).map((e, i) => (
                      <span key={i} style={styles.reasonBadge}>{PUNCH_LABELS[e.type]}:{e.reason}</span>
                    ))}
                  </span>
                  <span style={styles.dayWork}>{minToHM(d.summary.work_min)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={`${PUNCH_LABELS[confirm]}しますか？`}
          message={clock}
          yesLabel="YES"
          noLabel="NO"
          onYes={() => punch(confirm)}
          onNo={() => setConfirm(null)}
        />
      )}

      {reasonAsk && (
        <div style={styles.overlay}>
          <div style={styles.reasonBox}>
            <div style={styles.reasonTitle}>{PUNCH_LABELS[reasonAsk.type]}の理由</div>
            <p style={styles.reasonMsg}>{reasonAsk.message}</p>
            <div style={styles.chips}>
              {REASON_CHIPS.map((c) => (
                <button key={c} style={reason === c ? styles.chipActive : styles.chip} onClick={() => setReason(c)}>
                  {c}
                </button>
              ))}
            </div>
            <textarea
              style={styles.textarea}
              rows={3}
              placeholder="例: 直行で◯◯クリニックへ配達"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div style={styles.reasonButtons}>
              <button style={styles.cancel} onClick={() => { setReasonAsk(null); setReason(""); }}>
                やめる
              </button>
              <button style={styles.submit} disabled={!reason.trim() || !!busy} onClick={submitReason}>
                理由を付けて{PUNCH_LABELS[reasonAsk.type]}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const chip = { padding: "0.45rem 0.8rem", borderRadius: "999px", fontSize: "0.85rem", cursor: "pointer" };

const styles = {
  container: { padding: "1rem", maxWidth: "520px", margin: "0 auto" },
  statusCard: { background: "#fff", borderRadius: "14px", padding: "1rem", textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  clock: { fontSize: "2.2rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  dateLine: { fontSize: "0.85rem", color: "#666" },
  state: { marginTop: "0.4rem", fontWeight: 700 },
  buttonGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem", marginTop: "1rem" },
  punchButton: { padding: "1.3rem 0", borderRadius: "14px", border: "none", fontSize: "1.25rem", fontWeight: 700, cursor: "pointer" },
  busy: { textAlign: "center", color: "#2563eb", fontSize: "0.9rem" },
  locationNote: { fontSize: "0.72rem", color: "#888", textAlign: "center", margin: "0.6rem 0 0" },
  error: { color: "#dc2626", fontSize: "0.85rem", textAlign: "center" },
  monthHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "1.5rem 0 0.6rem" },
  monthNav: { width: "2.4rem", height: "2.4rem", borderRadius: "8px", border: "1px solid #ddd", background: "#fff", fontSize: "1.2rem", cursor: "pointer" },
  monthTitle: { fontWeight: 700, fontSize: "1.05rem" },
  totals: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", background: "#fff", borderRadius: "12px", padding: "0.7rem 0", textAlign: "center", fontSize: "0.75rem", color: "#666", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  totalNum: { fontSize: "1.1rem", fontWeight: 700, color: "#111" },
  muted: { color: "#888", textAlign: "center", fontSize: "0.9rem" },
  dayList: { marginTop: "0.7rem", background: "#fff", borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  dayRow: { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.8rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem" },
  dayDate: { width: "4.6rem", flexShrink: 0, color: "#555" },
  dayTimes: { flex: 1, display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" },
  small: { color: "#888" },
  reasonBadge: { fontSize: "0.68rem", background: "#fff7ed", color: "#c2410c", borderRadius: "4px", padding: "0.05rem 0.3rem" },
  dayWork: { fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "1.2rem" },
  reasonBox: { background: "#fff", borderRadius: "14px", width: "100%", maxWidth: "380px", padding: "1.2rem" },
  reasonTitle: { fontWeight: 700, fontSize: "1.1rem" },
  reasonMsg: { fontSize: "0.85rem", color: "#c2410c", margin: "0.4rem 0 0.8rem" },
  chips: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" },
  chip: { ...chip, border: "1px solid #ccc", background: "#fff" },
  chipActive: { ...chip, border: "1px solid #2563eb", background: "#2563eb", color: "#fff" },
  textarea: { width: "100%", padding: "0.6rem", borderRadius: "8px", border: "1px solid #ccc", fontSize: "1rem", resize: "vertical" },
  reasonButtons: { display: "flex", gap: "0.5rem", marginTop: "0.8rem" },
  cancel: { flex: 1, padding: "0.75rem", borderRadius: "10px", border: "1px solid #ccc", background: "#fff", cursor: "pointer" },
  submit: { flex: 2, padding: "0.75rem", borderRadius: "10px", border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" },
  toast: { position: "fixed", left: "50%", bottom: "calc(90px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "0.7rem 1.2rem", borderRadius: "999px", fontSize: "0.9rem", zIndex: 400 },
};
