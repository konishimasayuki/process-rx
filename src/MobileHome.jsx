import { useEffect, useState } from "react";
import { STATE_LABELS, hm } from "./timeUtils.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "おはようございます";
  if (h < 18) return "こんにちは";
  return "お疲れさまです";
}

export default function MobileHome({ session, onNavigate }) {
  const [data, setData] = useState(null);

  async function load() {
    const res = await fetch("/api/home-summary");
    if (res.ok) setData(await res.json());
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.hello}>
        {session.name}さん、{greeting()}
      </div>

      {data?.me && (
        <button style={styles.meCard} onClick={() => onNavigate("timecard")}>
          <span style={styles.cardLabel}>あなたの勤怠</span>
          <span style={{ ...styles.meState, color: data.me.state === "off" ? "#6b7280" : "#047857" }}>
            {STATE_LABELS[data.me.state]}
          </span>
          <span style={styles.meSub}>
            {data.me.first_in ? `出勤 ${hm(data.me.first_in)}` : "まだ出勤していません"} ・ タイムカードを開く ›
          </span>
        </button>
      )}

      <div style={styles.tiles}>
        <button style={styles.tile} onClick={() => onNavigate("fax")}>
          <span style={styles.cardLabel}>本日のFAX</span>
          <span style={styles.big}>
            {data ? data.fax.faxes : "-"}<small style={styles.unit}>通</small>
          </span>
          <span style={styles.sub}>{data ? `${data.fax.patients}名分` : ""}</span>
          {data && data.fax.unprinted > 0 && <span style={styles.warn}>未印刷 {data.fax.unprinted}</span>}
          {data && data.fax.needs_review > 0 && <span style={styles.warn}>要確認 {data.fax.needs_review}</span>}
        </button>

        <button style={styles.tile} onClick={() => onNavigate("delivery")}>
          <span style={styles.cardLabel}>本日の配達</span>
          <span style={styles.big}>
            {data ? data.delivery.today : "-"}<small style={styles.unit}>件</small>
          </span>
          {data && data.delivery.unassigned > 0 && (
            <span style={styles.warn}>日付未定 {data.delivery.unassigned}</span>
          )}
        </button>
      </div>

      {data?.staff && (
        <div style={styles.staffCard}>
          <div style={styles.cardLabel}>スタッフの出勤状況</div>
          {data.staff.length === 0 && <div style={styles.sub}>従業員が登録されていません</div>}
          {data.staff.map((s) => (
            <div key={s.name} style={styles.staffRow}>
              <span>{s.name}</span>
              <span style={{ color: s.state === "off" ? "#9ca3af" : "#047857", fontWeight: 600 }}>
                {s.state === "off" ? (s.first_in ? "退勤済" : "未出勤") : STATE_LABELS[s.state]}
                {s.first_in && <small style={styles.small}> {hm(s.first_in)}〜</small>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const card = {
  background: "#fff",
  borderRadius: "14px",
  padding: "1rem",
  boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  border: "none",
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  cursor: "pointer",
};

const styles = {
  container: { padding: "1rem", maxWidth: "520px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.8rem" },
  hello: { fontSize: "1.05rem", fontWeight: 700, padding: "0.3rem 0.2rem" },
  meCard: { ...card, width: "100%" },
  cardLabel: { fontSize: "0.75rem", color: "#888" },
  meState: { fontSize: "1.4rem", fontWeight: 700 },
  meSub: { fontSize: "0.8rem", color: "#555" },
  tiles: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" },
  tile: { ...card },
  big: { fontSize: "2rem", fontWeight: 700, lineHeight: 1.2 },
  unit: { fontSize: "0.9rem", marginLeft: "0.15rem" },
  sub: { fontSize: "0.8rem", color: "#555" },
  warn: { fontSize: "0.72rem", color: "#c2410c", background: "#fff7ed", borderRadius: "4px", padding: "0.1rem 0.35rem", alignSelf: "flex-start" },
  staffCard: { ...card, cursor: "default" },
  staffRow: { display: "flex", justifyContent: "space-between", padding: "0.45rem 0", borderBottom: "1px solid #f3f4f6", fontSize: "0.9rem" },
  small: { color: "#888", fontWeight: 400 },
};
