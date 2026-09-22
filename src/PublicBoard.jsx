import { useEffect, useState } from "react";
import MapPreview from "./MapPreview.jsx";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";
import DestinationPicker from "./DestinationPicker.jsx";
import { driverColor } from "./driverColors.js";

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDate(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
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

function emptyAddForm(date) {
  return {
    destination_id: "",
    date,
    driver: "",
    time_type: "ALL",
    time_value: "",
  };
}

export default function PublicBoard() {
  const [date, setDate] = useState(todayStr());
  const [drivers, setDrivers] = useState([]);
  const [depotAddress, setDepotAddress] = useState(null);
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm(todayStr()));
  const [addError, setAddError] = useState("");

  const [editModal, setEditModal] = useState(null);
  const [editError, setEditError] = useState("");

  async function load(silent) {
    if (!silent) setLoading(true);
    const res = await fetch(`/api/delivery-board?date=${date}`);
    const data = await res.json();
    setDrivers(data.drivers || []);
    if (data.depot_address) setDepotAddress(data.depot_address);
    if (!silent) setLoading(false);
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function openAddModal() {
    setAddForm(emptyAddForm(date));
    setAddError("");
    setAddModalOpen(true);
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setAddError("");

    if (!addForm.destination_id || !addForm.date) {
      setAddError("配達先と日付は必須です");
      return;
    }
    if (addForm.time_type === "FIXED" && !addForm.time_value) {
      setAddError("時間指定の場合は時刻を入力してください");
      return;
    }

    const res = await fetch("/api/delivery-board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error || "登録に失敗しました");
      return;
    }

    setAddModalOpen(false);
    loadDrivers();
    if (addForm.date === date) {
      load(true);
    }
  }

  function openEditModal(stop, driver) {
    setEditModal({
      entryId: stop.entry_id,
      facilityName: stop.facility_name,
      name: stop.name,
      address: stop.address,
      date,
      driver: driver || "",
      time_type: stop.time_type || "ALL",
      time_value: stop.time_value || "",
    });
    setEditError("");
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    setEditError("");

    if (editModal.time_type === "FIXED" && !editModal.time_value) {
      setEditError("時間指定の場合は時刻を入力してください");
      return;
    }

    const res = await fetch("/api/delivery-board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editModal.entryId,
        new_date: editModal.date,
        new_driver: editModal.driver,
        time_type: editModal.time_type,
        time_value: editModal.time_value,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setEditError(data.error || "更新に失敗しました");
      return;
    }

    setEditModal(null);
    loadDrivers();
    load(true);
  }

  async function handleDelete() {
    if (!confirm("この配達をボードから削除しますか？")) return;
    await fetch("/api/delivery-board", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editModal.entryId, date: editModal.date }),
    });
    setEditModal(null);
    load(true);
  }

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
          onClick={() => setDate((d) => shiftDate(d, -1))}
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
          onClick={() => setDate((d) => shiftDate(d, 1))}
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
                    <div
                      style={styles.stopBody}
                      onClick={() => openEditModal(stop, d.driver)}
                    >
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

      <FloatingAddButton onClick={openAddModal} />

      {addModalOpen && (
        <Modal title="配達をボードに追加" onClose={() => setAddModalOpen(false)}>
          <form style={styles.form} onSubmit={handleAddSubmit}>
            <input
              style={styles.input}
              type="date"
              value={addForm.date}
              onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
            />

            <DestinationPicker
              destinations={destinations}
              value={addForm.destination_id}
              onChange={(id) => setAddForm({ ...addForm, destination_id: id })}
            />

            <select
              style={styles.input}
              value={addForm.driver}
              onChange={(e) => setAddForm({ ...addForm, driver: e.target.value })}
            >
              <option value="">未割当</option>
              {knownDrivers.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              style={styles.input}
              value={addForm.time_type}
              onChange={(e) =>
                setAddForm({ ...addForm, time_type: e.target.value })
              }
            >
              <option value="ALL">いつでも(ALL)</option>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
              <option value="FIXED">時間指定</option>
            </select>

            {addForm.time_type === "FIXED" && (
              <input
                style={styles.input}
                type="time"
                value={addForm.time_value}
                onChange={(e) =>
                  setAddForm({ ...addForm, time_value: e.target.value })
                }
              />
            )}

            {addError && <p style={styles.error}>{addError}</p>}

            <button style={styles.button} type="submit">
              ボードに追加
            </button>
          </form>
        </Modal>
      )}

      {editModal && (
        <Modal title="配達内容を編集" onClose={() => setEditModal(null)}>
          <form style={styles.form} onSubmit={handleEditSubmit}>
            <div style={styles.editTargetInfo}>
              {editModal.facilityName && (
                <span style={styles.facilityTag}>{editModal.facilityName}</span>
              )}
              <strong>{editModal.name}様</strong>
              <div style={styles.address}>{editModal.address}</div>
            </div>

            <label style={styles.editLabel}>
              日付
              <input
                style={styles.input}
                type="date"
                value={editModal.date}
                onChange={(e) =>
                  setEditModal({ ...editModal, date: e.target.value })
                }
              />
            </label>

            <label style={styles.editLabel}>
              ドライバー
              <select
                style={styles.input}
                value={editModal.driver}
                onChange={(e) =>
                  setEditModal({ ...editModal, driver: e.target.value })
                }
              >
                <option value="">未割当</option>
                {knownDrivers.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.editLabel}>
              時間
              <select
                style={styles.input}
                value={editModal.time_type}
                onChange={(e) =>
                  setEditModal({ ...editModal, time_type: e.target.value })
                }
              >
                <option value="ALL">いつでも(ALL)</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
                <option value="FIXED">時間指定</option>
              </select>
            </label>

            {editModal.time_type === "FIXED" && (
              <input
                style={styles.input}
                type="time"
                value={editModal.time_value}
                onChange={(e) =>
                  setEditModal({ ...editModal, time_value: e.target.value })
                }
              />
            )}

            {editError && <p style={styles.error}>{editError}</p>}

            <div style={styles.formButtons}>
              <button style={styles.button} type="submit">
                保存
              </button>
              <button
                type="button"
                style={styles.dangerButton}
                onClick={handleDelete}
              >
                削除
              </button>
            </div>
          </form>
        </Modal>
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
  stopBody: { flex: 1, minWidth: 0, cursor: "pointer" },
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

  form: { display: "flex", flexDirection: "column", gap: "0.6rem" },
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
  dangerButton: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  formButtons: { display: "flex", gap: "0.5rem" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  editTargetInfo: {
    background: "#f9fafb",
    borderRadius: "8px",
    padding: "0.6rem",
    fontSize: "0.85rem",
  },
  editLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    fontSize: "0.8rem",
    color: "#555",
  },
};
