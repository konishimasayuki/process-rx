import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";
import MapPreview from "./MapPreview.jsx";
import DestinationPicker from "./DestinationPicker.jsx";
import { driverColor } from "./driverColors.js";

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

function formatShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function emptyForm(date) {
  return {
    destination_id: "",
    dateMode: "specific", // specific | due
    date: date || todayStr(),
    due_date: date || todayStr(),
    driver: "",
    time_type: "ALL",
    time_value: "",
  };
}

export default function DeliveryBoard() {
  const [startDate, setStartDate] = useState(todayStr());
  const [days, setDays] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [depotAddress, setDepotAddress] = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [knownDrivers, setKnownDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [draggingId, setDraggingId] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [lineSendStatus, setLineSendStatus] = useState({});
  const [optimizeStatus, setOptimizeStatus] = useState({});
  const [editModal, setEditModal] = useState(null); // {entryId, date, driver, time_type, time_value}
  const [editError, setEditError] = useState("");
  const dragInfo = useRef(null);

  async function loadWeek(silent) {
    if (!silent) setLoading(true);
    const res = await fetch(
      `/api/delivery-board?start_date=${startDate}&days=7`
    );
    const data = await res.json();
    setDays(data.days || []);
    setUnassigned(data.unassigned || []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate]);

  function openAddModal(date) {
    setForm(emptyForm(date));
    setError("");
    setModalOpen(true);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError("");

    if (!form.destination_id) {
      setError("配達先を選択してください");
      return;
    }
    if (form.dateMode === "specific" && !form.date) {
      setError("日付を入力してください");
      return;
    }
    if (form.dateMode === "due" && !form.due_date) {
      setError("◯日までの日付を入力してください");
      return;
    }
    if (form.time_type === "FIXED" && !form.time_value) {
      setError("時間指定の場合は時刻を入力してください");
      return;
    }

    const payload = {
      destination_id: form.destination_id,
      driver: form.driver,
      time_type: form.time_type,
      time_value: form.time_value,
      ...(form.dateMode === "specific"
        ? { date: form.date }
        : { due_date: form.due_date }),
    };

    const res = await fetch("/api/delivery-board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登録に失敗しました");
      return;
    }

    setModalOpen(false);
    loadWeek(true);
    loadDrivers();
  }

  async function handleRemove(entryId, date) {
    if (!confirm("この配達をボードから削除しますか？")) return;
    await fetch("/api/delivery-board", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, date }),
    });
    loadWeek(true);
  }

  async function handleMoveStop(date, driver, stops, currentIndex, direction) {
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= stops.length) return;

    const entryId = stops[currentIndex].entry_id;
    await fetch("/api/delivery-board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entryId,
        new_date: date,
        new_driver: driver,
        new_index: newIndex,
      }),
    });
    loadWeek(true);
  }

  async function handleAssignDate(entryId, date) {
    if (!date) return;
    await fetch("/api/delivery-board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId, new_date: date }),
    });
    loadWeek(true);
  }

  function timeLabel(stop) {
    if (stop.time_type === "FIXED") return stop.time_value;
    if (stop.time_type === "AM") return "AM";
    if (stop.time_type === "PM") return "PM";
    return "いつでも";
  }

  async function handleOptimize(date, driver) {
    const key = `${date}|${driver}`;
    setOptimizeStatus((prev) => ({ ...prev, [key]: "running" }));

    await fetch("/api/delivery-board-optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, driver }),
    });

    await loadWeek(true);
    setOptimizeStatus((prev) => ({ ...prev, [key]: "done" }));
  }

  async function handleSendLine(date, d) {
    const key = `${date}|${d.driver}`;
    setLineSendStatus((prev) => ({ ...prev, [key]: "sending" }));

    const res = await fetch("/api/line-send-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver: d.driver,
        date,
        stops: d.stops,
        maps_url: d.maps_url,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLineSendStatus((prev) => ({
        ...prev,
        [key]: `error:${data.error || "送信に失敗しました"}`,
      }));
      return;
    }

    setLineSendStatus((prev) => ({ ...prev, [key]: "sent" }));
  }

  function openEditModal(stop, date, driver) {
    setEditModal({
      entryId: stop.entry_id,
      facilityName: stop.facility_name,
      name: stop.name,
      address: stop.address,
      date: date === "unassigned" ? "" : date,
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

    const payload = {
      id: editModal.entryId,
      new_driver: editModal.driver,
      time_type: editModal.time_type,
      time_value: editModal.time_value,
    };
    if (editModal.date) {
      payload.new_date = editModal.date;
    }

    const res = await fetch("/api/delivery-board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setEditError(data.error || "更新に失敗しました");
      return;
    }

    setEditModal(null);
    loadWeek(true);
    loadDrivers();
  }

  // ==== ドラッグ&ドロップ(上下入れ替え/日付変更/未割り当てへ) ====
  function handleHandlePointerDown(e, stop, date, driver) {
    e.preventDefault();
    dragInfo.current = { entryId: stop.entry_id, sourceDate: date, sourceDriver: driver };
    setDraggingId(stop.entry_id);
    setDragPreview({
      x: e.clientX,
      y: e.clientY,
      facilityName: stop.facility_name,
      name: stop.name,
      address: stop.address,
    });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function handlePointerMove(e) {
    setDragPreview((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  }

  async function handlePointerUp(e) {
    window.removeEventListener("pointermove", handlePointerMove);
    const drag = dragInfo.current;
    dragInfo.current = null;
    setDraggingId(null);
    setDragPreview(null);
    if (!drag) return;

    const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
    const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;
    if (clientX == null || clientY == null) return;

    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return;

    const dayEl = el.closest("[data-day-date]");
    if (!dayEl) return;
    const targetDate = dayEl.getAttribute("data-day-date");

    const driverEl = el.closest("[data-driver-group]");
    const targetDriver = driverEl
      ? driverEl.getAttribute("data-driver-group")
      : drag.sourceDriver;

    let newIndex;
    if (driverEl) {
      const stopEl = el.closest("[data-entry-id]");
      const siblings = Array.from(
        driverEl.querySelectorAll("[data-entry-id]")
      );
      if (stopEl && siblings.includes(stopEl)) {
        newIndex = siblings.indexOf(stopEl);
      } else {
        newIndex = siblings.length;
      }
    }

    if (
      targetDate === drag.sourceDate &&
      targetDriver === drag.sourceDriver &&
      newIndex === undefined
    ) {
      return; // 変化なし
    }

    await fetch("/api/delivery-board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: drag.entryId,
        new_date: targetDate,
        new_driver: targetDriver,
        new_index: newIndex,
      }),
    });
    loadWeek(true);
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>配達ボード</h2>
        <input
          style={styles.calendarInput}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <div style={styles.weekRow}>
          {/* 未割り当て(◯日までのみ指定・日付未確定のもの) */}
          <div data-day-date="unassigned" style={styles.dayColumn}>
            <div style={styles.dayHeader}>未割り当て</div>

            {unassigned.length === 0 ? (
              <p style={styles.muted}>ありません</p>
            ) : (
              <ol style={styles.stopList}>
                {unassigned.map((stop) => (
                  <li
                    key={stop.entry_id}
                    data-entry-id={stop.entry_id}
                    style={{
                      ...styles.stopItem,
                      opacity: draggingId === stop.entry_id ? 0.4 : 1,
                    }}
                  >
                    <span
                      style={styles.dragHandle}
                      onPointerDown={(e) =>
                        handleHandlePointerDown(e, stop, "unassigned", stop.driver)
                      }
                    >
                      ⠿
                    </span>
                    <div
                      style={styles.stopBody}
                      onClick={() =>
                        openEditModal(stop, "unassigned", stop.driver)
                      }
                    >
                      <div style={styles.stopNameRow}>
                        {stop.facility_name && (
                          <span style={styles.facilityTag}>
                            {stop.facility_name}
                          </span>
                        )}
                        <strong>{stop.name}様</strong>
                      </div>
                      <div style={styles.address}>{stop.address}</div>
                      {stop.due_date && (
                        <div style={styles.dueDateTag}>
                          {formatShort(stop.due_date)}まで
                        </div>
                      )}
                      <input
                        type="date"
                        style={styles.assignDateInput}
                        defaultValue=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleAssignDate(stop.entry_id, e.target.value)
                        }
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <button
              style={styles.emptyAddButton}
              onClick={() => {
                setForm({ ...emptyForm(), dateMode: "due" });
                setError("");
                setModalOpen(true);
              }}
            >
              + 追加
            </button>
          </div>

          {days.map((day) => (
            <div
              key={day.date}
              data-day-date={day.date}
              style={styles.dayColumn}
            >
              <div style={styles.dayHeader}>{formatDayHeader(day.date)}</div>

              {day.drivers?.map((d) => (
                <div
                  key={d.driver}
                  data-driver-group={d.driver}
                  style={styles.driverBlock}
                >
                  <div style={styles.driverHeader}>
                    <span
                      style={{
                        ...styles.driverName,
                        color: driverColor(d.driver, knownDrivers),
                      }}
                    >
                      {d.driver}
                    </span>
                    <div style={styles.driverHeaderActions}>
                      {!d.maps_url && (
                        <span style={styles.geoWarning}>位置未取得</span>
                      )}
                      <button
                        style={{
                          ...styles.optimizeButton,
                          borderColor: driverColor(d.driver, knownDrivers),
                          color: driverColor(d.driver, knownDrivers),
                        }}
                        disabled={
                          optimizeStatus[`${day.date}|${d.driver}`] === "running"
                        }
                        onClick={() => handleOptimize(day.date, d.driver)}
                      >
                        {optimizeStatus[`${day.date}|${d.driver}`] === "running"
                          ? "最適化中..."
                          : "順序最適化"}
                      </button>
                      {d.driver && d.driver !== "未割当" && (
                        <button
                          style={styles.lineSendButton}
                          disabled={lineSendStatus[`${day.date}|${d.driver}`] === "sending"}
                          onClick={() => handleSendLine(day.date, d)}
                        >
                          {lineSendStatus[`${day.date}|${d.driver}`] === "sending"
                            ? "送信中..."
                            : lineSendStatus[`${day.date}|${d.driver}`] === "sent"
                            ? "送信済み"
                            : "LINEに送信"}
                        </button>
                      )}
                    </div>
                  </div>
                  {lineSendStatus[`${day.date}|${d.driver}`]?.startsWith?.("error:") && (
                    <p style={styles.lineSendError}>
                      {lineSendStatus[`${day.date}|${d.driver}`].slice(6)}
                    </p>
                  )}
                  <ol style={styles.stopList}>
                    {d.stops.map((stop, idx) => (
                      <li
                        key={stop.entry_id}
                        data-entry-id={stop.entry_id}
                        style={{
                          ...styles.stopItem,
                          opacity: draggingId === stop.entry_id ? 0.4 : 1,
                        }}
                      >
                        <span
                          style={styles.dragHandle}
                          onPointerDown={(e) =>
                            handleHandlePointerDown(e, stop, day.date, d.driver)
                          }
                        >
                          ⠿
                        </span>
                        <span
                          style={{
                            ...styles.stopOrder,
                            background: driverColor(d.driver, knownDrivers),
                          }}
                        >
                          {idx + 1}
                        </span>
                        <div
                          style={styles.stopBody}
                          onClick={() => openEditModal(stop, day.date, d.driver)}
                        >
                          <div style={styles.stopNameRow}>
                            {stop.facility_name && (
                              <span style={styles.facilityTag}>
                                {stop.facility_name}
                              </span>
                            )}
                            <strong>{stop.name}様</strong>
                            <span style={styles.timeTag}>
                              {timeLabel(stop)}
                            </span>
                          </div>
                          <div style={styles.address}>{stop.address}</div>
                        </div>
                        <div style={styles.reorderButtons}>
                          <button
                            style={styles.reorderButton}
                            disabled={idx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveStop(day.date, d.driver, d.stops, idx, "up");
                            }}
                          >
                            ↑
                          </button>
                          <button
                            style={styles.reorderButton}
                            disabled={idx === d.stops.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveStop(day.date, d.driver, d.stops, idx, "down");
                            }}
                          >
                            ↓
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}

              <button
                style={styles.emptyAddButton}
                onClick={() => openAddModal(day.date)}
              >
                + 追加
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <MapPreview
          days={days}
          depotAddress={depotAddress}
          knownDrivers={knownDrivers}
          showAllOption={false}
        />
      )}

      <FloatingAddButton onClick={() => openAddModal()} />

      {dragPreview && (
        <div
          style={{
            ...styles.dragPreview,
            left: dragPreview.x + 12,
            top: dragPreview.y + 12,
          }}
        >
          {dragPreview.facilityName && (
            <span style={styles.facilityTag}>{dragPreview.facilityName}</span>
          )}
          <strong>{dragPreview.name}様</strong>
          <div style={styles.address}>{dragPreview.address}</div>
        </div>
      )}

      {modalOpen && (
        <Modal title="配達をボードに追加" onClose={() => setModalOpen(false)}>
          <form style={styles.form} onSubmit={handleAdd}>
            <DestinationPicker
              destinations={destinations}
              value={form.destination_id}
              onChange={(id) => setForm({ ...form, destination_id: id })}
            />

            <div style={styles.dateModeRow}>
              <button
                type="button"
                style={
                  form.dateMode === "specific"
                    ? styles.modeButtonActive
                    : styles.modeButton
                }
                onClick={() => setForm({ ...form, dateMode: "specific" })}
              >
                日付指定
              </button>
              <button
                type="button"
                style={
                  form.dateMode === "due"
                    ? styles.modeButtonActive
                    : styles.modeButton
                }
                onClick={() => setForm({ ...form, dateMode: "due" })}
              >
                ◯日までに(未割り当て)
              </button>
            </div>

            {form.dateMode === "specific" ? (
              <input
                style={styles.input}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            ) : (
              <input
                style={styles.input}
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            )}

            <select
              style={styles.input}
              value={form.driver}
              onChange={(e) => setForm({ ...form, driver: e.target.value })}
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
                onClick={() => {
                  setEditModal(null);
                  handleRemove(
                    editModal.entryId,
                    editModal.date === "unassigned" ? null : editModal.date
                  );
                }}
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
  container: { padding: "1rem", maxWidth: "100%", margin: "0 auto", minWidth: 0 },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.8rem",
  },
  heading: { fontSize: "1.2rem", margin: 0 },
  calendarInput: {
    padding: "0.4rem 0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "0.85rem",
  },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  form: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  dateModeRow: { display: "flex", gap: "0.4rem" },
  modeButton: {
    flex: 1,
    padding: "0.5rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  modeButtonActive: {
    flex: 1,
    padding: "0.5rem",
    borderRadius: "6px",
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.8rem",
    cursor: "pointer",
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
  formButtons: { display: "flex", gap: "0.5rem" },
  dangerButton: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
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
  muted: { color: "#888", fontSize: "0.8rem" },
  weekRow: {
    display: "flex",
    gap: "0.8rem",
    overflowX: "auto",
    paddingBottom: "5rem",
  },
  dayColumn: {
    minWidth: "220px",
    maxWidth: "220px",
    background: "#fff",
    borderRadius: "10px",
    padding: "0.8rem",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
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
    flexWrap: "wrap",
    gap: "0.3rem",
  },
  driverHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  lineSendButton: {
    fontSize: "0.65rem",
    padding: "0.15rem 0.4rem",
    borderRadius: "5px",
    border: "1px solid #16a34a",
    background: "#fff",
    color: "#16a34a",
    cursor: "pointer",
  },
  lineSendError: {
    fontSize: "0.65rem",
    color: "#dc2626",
    margin: "0 0 0.3rem 0",
  },
  driverName: { fontSize: "0.85rem", fontWeight: 600 },
  optimizeButton: {
    fontSize: "0.65rem",
    padding: "0.15rem 0.4rem",
    borderRadius: "5px",
    border: "1px solid #2563eb",
    background: "#fff",
    color: "#2563eb",
    cursor: "pointer",
  },
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
    gap: "0.3rem",
    borderTop: "1px dashed #eee",
    paddingTop: "0.4rem",
  },
  dragHandle: {
    cursor: "grab",
    color: "#bbb",
    fontSize: "0.9rem",
    touchAction: "none",
    flexShrink: 0,
    paddingTop: "0.1rem",
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
  stopBody: { flex: 1, minWidth: 0, cursor: "pointer" },
  stopNameRow: {
    fontSize: "0.8rem",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.2rem",
    alignItems: "center",
  },
  facilityTag: { fontSize: "0.65rem", color: "#2563eb" },
  timeTag: {
    fontSize: "0.6rem",
    background: "#eef2ff",
    color: "#4338ca",
    borderRadius: "4px",
    padding: "0.05rem 0.3rem",
  },
  dueDateTag: {
    fontSize: "0.65rem",
    color: "#d97706",
    marginTop: "0.15rem",
  },
  assignDateInput: {
    marginTop: "0.3rem",
    fontSize: "0.7rem",
    padding: "0.2rem",
    borderRadius: "4px",
    border: "1px solid #ccc",
    width: "100%",
    boxSizing: "border-box",
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
  reorderButtons: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    flexShrink: 0,
  },
  reorderButton: {
    width: "1.4rem",
    height: "1.1rem",
    fontSize: "0.7rem",
    lineHeight: 1,
    border: "1px solid #ddd",
    borderRadius: "4px",
    background: "#fff",
    color: "#333",
    cursor: "pointer",
    padding: 0,
  },
  emptyAddButton: {
    marginTop: "0.4rem",
    padding: "0.5rem",
    borderRadius: "8px",
    border: "1px dashed #ccc",
    background: "#f9fafb",
    color: "#999",
    fontSize: "0.8rem",
    cursor: "pointer",
    flex: 1,
  },
  dragPreview: {
    position: "fixed",
    pointerEvents: "none",
    background: "#fff",
    border: "1px solid #2563eb",
    borderRadius: "8px",
    padding: "0.5rem 0.7rem",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
    fontSize: "0.8rem",
    zIndex: 100,
    maxWidth: "200px",
  },
};
