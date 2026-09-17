import { useEffect, useState } from "react";

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayHeader(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
}

export default function DeliveryBoard() {
  const [startDate] = useState(todayStr());
  const [days, setDays] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    destination_id: "",
    date: todayStr(),
    driver: "",
    time_type: "ALL",
    time_value: "",
  });

  async function loadWeek() {
    setLoading(true);
    const res = await fetch(
      `/api/delivery-board?start_date=${startDate}&days=7`
    );
    const data = await res.json();
    setDays(data.days || []);
    setLoading(false);
  }

  async function loadDestinations() {
    const res = await fetch("/api/destinations");
    const data = await res.json();
    setDestinations(data.destinations || []);
  }

  async function loadDrivers() {
    const res = await fetch("/api/drivers");
    const data = await res.json();
    setKnownDrivers(data.drivers || []);
  }

  useEffect(() => {
    loadDestinations();
    loadDrivers();
    loadWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");

    if (!form.destination_id || !form.date) {
      setError("配達先と日付は必須です");
      return;
    }
    if (form.time_type === "FIXED" && !form.time_value) {
      setError("時間指定の場合は時刻を入力してください");
      return;
    }

    const res = await fetch("/api/delivery-board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登録に失敗しました");
      return;
    }

    setForm({
      destination_id: "",
      date: form.date,
      driver: "",
      time_type: "ALL",
      time_value: "",
    });
    loadWeek();
    loadDrivers();
  }

  async function handleRemove(entryId, date) {
    await fetch("/api/delivery-board", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, date }),
    });
    loadWeek();
  }

  function timeLabel(stop) {
    if (stop.time_type === "FIXED") return stop.time_value;
    if (stop.time_type === "AM") return "AM";
    if (stop.time_type === "PM") return "PM";
    return "いつでも";
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>配達ボード</h2>

      <form style={styles.form} onSubmit={handleAdd}>
        <input
          style={styles.input}
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />

        <select
          style={styles.input}
          value={form.destination_id}
          onChange={(e) => setForm({ ...form, destination_id: e.target.value })}
        >
          <option value="">配達先を選択</option>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.facility_name ? `[${d.facility_name}] ` : ""}
              {d.name}様 - {d.address}
            </option>
          ))}
        </select>

        <input
          style={styles.input}
          placeholder="ドライバー名(任意)"
          list="known-drivers"
          value={form.driver}
          onChange={(e) => setForm({ ...form, driver: e.target.value })}
        />
        <datalist id="known-drivers">
          {knownDrivers.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <select
          style={styles.input}
          value={form.time_type}
          onChange={(e) => setForm({ ...form, time_type: e.target.value })}
        >
          <option value="ALL">いつでも(ALL)</option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
          <option value="FIXED">時間指定</option>
        </select>

        {form.time_type === "FIXED" && (
          <input
            style={styles.input}
            type="time"
            value={form.time_value}
            onChange={(e) => setForm({ ...form, time_value: e.target.value })}
          />
        )}

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.button} type="submit">
          ボードに追加
        </button>
      </form>

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <div style={styles.weekRow}>
          {days.map((day) => (
            <div key={day.date} style={styles.dayColumn}>
              <div style={styles.dayHeader}>{formatDayHeader(day.date)}</div>

              {!day.drivers?.length ? (
                <p style={styles.muted}>配達なし</p>
              ) : (
                day.drivers.map((d) => (
                  <div key={d.driver} style={styles.driverBlock}>
                    <div style={styles.driverHeader}>
                      <span style={styles.driverName}>{d.driver}</span>
                      {d.maps_url ? (
                        <a
                          style={styles.mapsLink}
                          href={d.maps_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          地図
                        </a>
                      ) : (
                        <span style={styles.geoWarning}>位置未取得</span>
                      )}
                    </div>
                    <ol style={styles.stopList}>
                      {d.stops.map((stop, idx) => (
                        <li key={stop.entry_id} style={styles.stopItem}>
                          <span style={styles.stopOrder}>{idx + 1}</span>
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
                          <button
                            style={styles.removeButton}
                            onClick={() => handleRemove(stop.entry_id, day.date)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "100%", margin: "0 auto" },
  heading: { fontSize: "1.2rem", marginBottom: "0.8rem" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginBottom: "1.5rem",
    background: "#fff",
    padding: "1rem",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    maxWidth: "480px",
  },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  muted: { color: "#888", fontSize: "0.85rem" },
  weekRow: {
    display: "flex",
    gap: "0.8rem",
    overflowX: "auto",
    paddingBottom: "1rem",
  },
  dayColumn: {
    minWidth: "220px",
    maxWidth: "220px",
    background: "#fff",
    borderRadius: "10px",
    padding: "0.8rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    flexShrink: 0,
  },
  dayHeader: {
    fontWeight: 700,
    fontSize: "0.95rem",
    marginBottom: "0.6rem",
    borderBottom: "1px solid #eee",
    paddingBottom: "0.4rem",
  },
  driverBlock: { marginBottom: "0.8rem" },
  driverHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.3rem",
  },
  driverName: { fontSize: "0.85rem", fontWeight: 600 },
  mapsLink: { fontSize: "0.7rem", color: "#2563eb" },
  geoWarning: { fontSize: "0.65rem", color: "#d97706" },
  stopList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  stopItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.4rem",
    borderTop: "1px dashed #eee",
    paddingTop: "0.4rem",
  },
  stopOrder: {
    background: "#2563eb",
    color: "#fff",
    borderRadius: "50%",
    width: "1.2rem",
    height: "1.2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.65rem",
    flexShrink: 0,
  },
  stopBody: { flex: 1, minWidth: 0 },
  stopNameRow: { fontSize: "0.8rem", display: "flex", flexWrap: "wrap", gap: "0.2rem", alignItems: "center" },
  facilityTag: { fontSize: "0.65rem", color: "#2563eb" },
  timeTag: {
    fontSize: "0.6rem",
    background: "#eef2ff",
    color: "#4338ca",
    borderRadius: "4px",
    padding: "0.05rem 0.3rem",
  },
  address: { fontSize: "0.7rem", color: "#555" },
  removeButton: {
    fontSize: "0.75rem",
    border: "none",
    background: "none",
    color: "#dc2626",
    cursor: "pointer",
    flexShrink: 0,
  },
};
