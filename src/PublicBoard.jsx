import { useEffect, useState } from "react";
import MapPreview from "./MapPreview.jsx";
import { driverColor } from "./driverColors.js";

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateHeader(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${
    weekdays[d.getDay()]
  })`;
}

function timeLabel(stop) {
  if (stop.time_type === "FIXED") return stop.time_value;
  if (stop.time_type === "AM") return "AM";
  if (stop.time_type === "PM") return "PM";
  return "いつでも";
}

export default function PublicBoard() {
  const [date, setDate] = useState(todayStr());
  const [drivers, setDrivers] = useState([]);
  const [depotAddress, setDepotAddress] = useState(null);
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/delivery-board?date=${date}`);
    const data = await res.json();
    setDrivers(data.drivers || []);
    if (data.depot_address) setDepotAddress(data.depot_address);
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/drivers")
      .then((res) => res.json())
      .then((data) => setKnownDrivers(data.drivers || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div style={styles.wrapper}>
      <style>{`
        html, body { margin: 0; overflow-x: hidden; background: #f4f5f7; }
        *, *::before, *::after { box-sizing: border-box; }
      `}</style>

      <header style={styles.header}>
        <span style={styles.headerTitle}>process-rx 配達ボード</span>
      </header>

      <div style={styles.dateRow}>
        <button
          style={styles.dateNavButton}
          onClick={() => {
            const d = new Date(`${date}T00:00:00`);
            d.setDate(d.getDate() - 1);
            setDate(
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                d.getDate()
              ).padStart(2, "0")}`
            );
          }}
        >
          ‹
        </button>
        <input
          style={styles.dateInput}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          style={styles.dateNavButton}
          onClick={() => {
            const d = new Date(`${date}T00:00:00`);
            d.setDate(d.getDate() + 1);
            setDate(
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                d.getDate()
              ).padStart(2, "0")}`
            );
          }}
        >
          ›
        </button>
        <button style={styles.todayButton} onClick={() => setDate(todayStr())}>
          今日
        </button>
      </div>

      <div style={styles.dateHeading}>{formatDateHeader(date)}</div>

      {loading ? (
        <p style={styles.muted}>読み込み中...</p>
      ) : drivers.length === 0 ? (
        <p style={styles.muted}>この日の配達はまだ登録されていません</p>
      ) : (
        drivers.map((d) => {
          const color = driverColor(d.driver, knownDrivers);
          return (
            <div key={d.driver} style={styles.driverCard}>
              <div style={styles.driverHeader}>
                <span style={{ ...styles.driverName, color }}>{d.driver}</span>
                {d.maps_url && (
                  <a
                    style={styles.mapsLink}
                    href={d.maps_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    経路を開く
                  </a>
                )}
              </div>
              <ol style={styles.stopList}>
                {d.stops.map((stop, idx) => (
                  <li key={stop.entry_id} style={styles.stopItem}>
                    <span style={{ ...styles.stopOrder, background: color }}>
                      {idx + 1}
                    </span>
                    <div style={styles.stopBody}>
                      <div style={styles.stopNameRow}>
                        {stop.facility_name && (
                          <span style={styles.facilityTag}>
                            {stop.facility_name}
                          </span>
                        )}
                        <strong>{stop.name}様</strong>
                        <span style={styles.timeTag}>{timeLabel(stop)}</span>
                      </div>
                      <div style={styles.address}>{stop.address}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          );
        })
      )}

      {!loading && (
        <MapPreview
          days={[{ date, drivers }]}
          depotAddress={depotAddress}
          knownDrivers={knownDrivers}
          showDayTabs={false}
        />
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: "0.8rem",
    paddingBottom: "3rem",
  },
  header: { marginBottom: "0.6rem" },
  headerTitle: { fontWeight: 700, fontSize: "1.05rem" },
  dateRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  },
  dateNavButton: {
    width: "2rem",
    height: "2rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    fontSize: "1.1rem",
    cursor: "pointer",
  },
  dateInput: {
    flex: 1,
    padding: "0.5rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "0.9rem",
  },
  todayButton: {
    padding: "0.5rem 0.7rem",
    borderRadius: "6px",
    border: "1px solid #2563eb",
    background: "#fff",
    color: "#2563eb",
    fontSize: "0.8rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  dateHeading: {
    fontSize: "1rem",
    fontWeight: 700,
    margin: "0.6rem 0",
  },
  muted: { color: "#888", fontSize: "0.9rem" },
  driverCard: {
    background: "#fff",
    borderRadius: "10px",
    padding: "0.8rem",
    marginBottom: "0.7rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  driverHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
    flexWrap: "wrap",
    gap: "0.3rem",
  },
  driverName: { fontSize: "0.95rem", fontWeight: 700 },
  mapsLink: { fontSize: "0.75rem", color: "#2563eb" },
  stopList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  stopItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    borderTop: "1px dashed #eee",
    paddingTop: "0.5rem",
  },
  stopOrder: {
    color: "#fff",
    borderRadius: "50%",
    width: "1.4rem",
    height: "1.4rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    flexShrink: 0,
  },
  stopBody: { flex: 1, minWidth: 0 },
  stopNameRow: {
    fontSize: "0.9rem",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
    alignItems: "center",
  },
  facilityTag: { fontSize: "0.7rem", color: "#2563eb" },
  timeTag: {
    fontSize: "0.65rem",
    background: "#eef2ff",
    color: "#4338ca",
    borderRadius: "4px",
    padding: "0.1rem 0.35rem",
  },
  address: { fontSize: "0.8rem", color: "#555", marginTop: "0.1rem" },
};
