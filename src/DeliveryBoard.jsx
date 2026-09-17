import { useEffect, useState } from "react";

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DeliveryBoard() {
  const [date, setDate] = useState(todayStr());
  const [board, setBoard] = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    destination_id: "",
    driver: "",
    time_type: "ALL",
    time_value: "",
  });

  async function loadBoard(targetDate) {
    setLoading(true);
    const res = await fetch(`/api/delivery-board?date=${targetDate}`);
    const data = await res.json();
    setBoard(data);
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
  }, []);

  useEffect(() => {
    loadBoard(date);
  }, [date]);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");

    if (!form.destination_id || !form.driver) {
      setError("配達先とドライバーは必須です");
      return;
    }
    if (form.time_type === "FIXED" && !form.time_value) {
      setError("時間指定の場合は時刻を入力してください");
      return;
    }

    const res = await fetch("/api/delivery-board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, date }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登録に失敗しました");
      return;
    }

    setForm({ destination_id: "", driver: "", time_type: "ALL", time_value: "" });
    loadBoard(date);
    loadDrivers();
  }

  async function handleRemove(entryId) {
    await fetch("/api/delivery-board", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, date }),
    });
    loadBoard(date);
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

      <input
        style={styles.dateInput}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />

      <form style={styles.form} onSubmit={handleAdd}>
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
          placeholder="ドライバー名"
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
      ) : !board?.drivers?.length ? (
        <p style={styles.muted}>この日はまだ配達が登録されていません</p>
      ) : (
        board.drivers.map((d) => (
          <div key={d.driver} style={styles.driverCard}>
            <div style={styles.driverHeader}>
              <h3 style={styles.driverName}>{d.driver}</h3>
              {d.maps_url ? (
                <a
                  style={styles.mapsLink}
                  href={d.maps_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  ルートを地図で見る
                </a>
              ) : (
                <span style={styles.geoWarning}>
                  位置情報未取得の配達先があり自動並び替え不可
                </span>
              )}
            </div>
            <ol style={styles.stopList}>
              {d.stops.map((stop, idx) => (
                <li key={stop.entry_id} style={styles.stopItem}>
                  <span style={styles.stopOrder}>{idx + 1}</span>
                  <div style={styles.stopBody}>
                    <div>
                      {stop.facility_name && (
                        <span style={styles.facilityTag}>{stop.facility_name}</span>
                      )}
                      <strong>{stop.name}様</strong>
                      <span style={styles.timeTag}>{timeLabel(stop)}</span>
                    </div>
                    <div style={styles.address}>{stop.address}</div>
                    {stop.notes && <div style={styles.notes}>{stop.notes}</div>}
                  </div>
                  <button
                    style={styles.removeButton}
                    onClick={() => handleRemove(stop.entry_id)}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "480px", margin: "0 auto" },
  heading: { fontSize: "1.2rem", marginBottom: "0.8rem" },
  dateInput: {
    padding: "0.5rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    marginBottom: "1rem",
    fontSize: "1rem",
  },
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
  muted: { color: "#888" },
  driverCard: {
    background: "#fff",
    borderRadius: "10px",
    padding: "1rem",
    marginBottom: "1rem",
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
  driverName: { margin: 0, fontSize: "1rem" },
  mapsLink: { fontSize: "0.8rem", color: "#2563eb" },
  geoWarning: { fontSize: "0.75rem", color: "#d97706" },
  stopList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" },
  stopItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.6rem",
    borderTop: "1px solid #eee",
    paddingTop: "0.5rem",
  },
  stopOrder: {
    background: "#2563eb",
    color: "#fff",
    borderRadius: "50%",
    width: "1.5rem",
    height: "1.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    flexShrink: 0,
  },
  stopBody: { flex: 1 },
  facilityTag: {
    fontSize: "0.7rem",
    color: "#2563eb",
    marginRight: "0.4rem",
  },
  timeTag: {
    fontSize: "0.7rem",
    background: "#eef2ff",
    color: "#4338ca",
    borderRadius: "4px",
    padding: "0.1rem 0.4rem",
    marginLeft: "0.5rem",
  },
  address: { fontSize: "0.8rem", color: "#555" },
  notes: { fontSize: "0.75rem", color: "#888" },
  removeButton: {
    fontSize: "0.7rem",
    padding: "0.25rem 0.5rem",
    borderRadius: "5px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    cursor: "pointer",
    flexShrink: 0,
  },
};
