import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal.jsx";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatTime(iso) {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(dateStr, today) {
  const d = new Date(`${dateStr}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function pagesLabel(pages) {
  if (!pages || pages.length === 0) return "—";
  return pages.length === 1 ? `${pages[0]}頁` : `${pages[0]}-${pages[pages.length - 1]}頁`;
}

// 1通のFAXごとにまとめる(送信元は1通につき1つ)
function groupByFax(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.fax_id || `${item.filename}|${item.received_at}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.values()]
    .map((rows) => rows.sort((a, b) => (a.group_index || 0) - (b.group_index || 0)))
    .sort((a, b) => new Date(b[0].received_at) - new Date(a[0].received_at));
}

function senderOf(rows) {
  const explicit = rows.find((r) => r.sender)?.sender;
  if (explicit) return explicit;
  return rows.find((r) => r.extracted?.issuing_institution)?.extracted.issuing_institution || null;
}

export default function FaxQueue({ canManage = false }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [today, setToday] = useState(null);
  const [date, setDate] = useState(null); // null = 今日
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // 患者さんの修正
  const [senderEdit, setSenderEdit] = useState(null); // 送信元の修正
  const [saveError, setSaveError] = useState("");
  const searchTimer = useRef(null);
  // 30秒ごとの自動更新でも、いま見ている日付・検索語を使うために保持
  const queryRef = useRef("");
  const dateRef = useRef(null);
  queryRef.current = query;
  dateRef.current = date;

  async function load(silent, opts = {}) {
    const q = opts.query !== undefined ? opts.query : queryRef.current;
    const d = opts.date !== undefined ? opts.date : dateRef.current;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      else if (d) params.set("date", d);
      const res = await fetch(`/api/fax-list?${params}`);
      if (!res.ok) {
        setError("読み込みに失敗しました");
      } else {
        const data = await res.json();
        setItems(data.items || []);
        setCounts(data.counts || {});
        setToday(data.today);
        setError("");
      }
    } catch {
      setError("通信エラーが発生しました");
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearchChange(value) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(false, { query: value }), 400);
  }

  function selectDate(d) {
    const next = d === today ? null : d;
    setQuery("");
    setDate(next);
    load(false, { query: "", date: next });
  }

  const faxes = useMemo(() => groupByFax(items), [items]);
  const hasDemo = items.some((i) => i.demo);
  const selected = date || today;
  const last7 = Object.keys(counts);
  const searching = query.trim().length > 0;

  async function toggleDemo() {
    setBusy(true);
    await fetch("/api/fax-demo", { method: hasDemo ? "DELETE" : "POST" });
    setQuery("");
    setDate(null);
    await load(true, { query: "", date: null });
    setBusy(false);
  }

  function openPdf(item) {
    if (!item.has_pdf) {
      alert("このPDFは大きすぎて保存されていません");
      return;
    }
    window.open(`/api/fax-pdf?id=${encodeURIComponent(item.id)}`, "_blank");
  }

  function applyUpdated(updated) {
    const map = new Map(updated.map((u) => [u.id, u]));
    setItems((prev) => prev.map((p) => map.get(p.id) || p));
  }

  function openEdit(item, rows) {
    setSaveError("");
    setEditing({
      item,
      sender: senderOf(rows),
      patient_name: item.extracted?.patient_name || "",
      patient_kana: item.extracted?.patient_kana || "",
      birth_date: item.extracted?.birth_date || "",
      is_prescription: item.is_prescription,
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const res = await fetch("/api/fax-edit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editing.item.id,
        patient_name: editing.patient_name,
        patient_kana: editing.patient_kana,
        birth_date: editing.birth_date,
        is_prescription: editing.is_prescription,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setSaveError(data.error || "保存に失敗しました");
    applyUpdated([data.item]);
    setEditing(null);
  }

  async function saveSender(e) {
    e.preventDefault();
    const res = await fetch("/api/fax-edit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: senderEdit.rows.map((r) => r.id), sender: senderEdit.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setSaveError(data.error || "保存に失敗しました");
    applyUpdated(data.items || []);
    setSenderEdit(null);
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>FAX受信一覧</h2>
        <div style={styles.headerButtons}>
          {canManage && (
            <button style={styles.subButton} onClick={toggleDemo} disabled={busy}>
              {hasDemo ? "サンプルを消す" : "サンプル表示"}
            </button>
          )}
          <button style={styles.subButton} onClick={() => load()}>
            更新
          </button>
        </div>
      </div>

      <div style={styles.searchBox}>
        <input
          style={styles.searchInput}
          placeholder="🔍 患者名・フリガナ・送信元で検索(過去30日)"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searching && (
          <button style={styles.clearButton} onClick={() => onSearchChange("")}>
            ×
          </button>
        )}
      </div>

      {!searching && today && (
        <div style={styles.chipRow}>
          {last7.map((d) => (
            <button
              key={d}
              style={d === selected ? styles.chipActive : styles.chip}
              onClick={() => selectDate(d)}
            >
              {dayLabel(d, today)}
              {counts[d] > 0 && <span style={styles.chipCount}>{counts[d]}</span>}
            </button>
          ))}
          {selected && !last7.includes(selected) && (
            <span style={styles.chipActive}>{dayLabel(selected, today)}</span>
          )}
          <label style={styles.calendarButton}>
            📅 日付指定
            <input
              type="date"
              style={styles.hiddenDate}
              value={selected || ""}
              onChange={(e) => e.target.value && selectDate(e.target.value)}
            />
          </label>
        </div>
      )}

      {searching && (
        <p style={styles.resultInfo}>
          「{query}」の検索結果 {items.length}件
        </p>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <p>読み込み中...</p>
      ) : faxes.length === 0 ? (
        <p style={styles.muted}>
          {searching ? "見つかりませんでした" : "この日に受信したFAXはありません"}
        </p>
      ) : (
        faxes.map((rows) => {
          const first = rows[0];
          const sender = senderOf(rows);
          const patients = rows.filter((r) => r.is_prescription).length;
          return (
            <section key={first.fax_id || first.id} style={styles.faxBlock}>
              <button
                style={styles.faxHeader}
                onClick={() => {
                  setSaveError("");
                  setSenderEdit({ rows, value: sender || "" });
                }}
              >
                <span style={styles.senderLine}>
                  <span style={sender ? styles.sender : styles.senderUnknown}>
                    {sender || "送信元 不明"}
                  </span>
                  <span style={styles.editMark}>✎</span>
                  {first.demo && <span style={styles.badgeDemo}>サンプル</span>}
                </span>
                <span style={styles.faxMeta}>
                  {formatTime(first.received_at)} 受信 ・ 全{first.source_page_count}頁 → {patients}名分
                </span>
              </button>

              {rows.map((item) => (
                <button key={item.id} style={styles.row} onClick={() => openEdit(item, rows)}>
                  <span style={styles.pages}>{pagesLabel(item.source_pages)}</span>
                  <span style={styles.main}>
                    {item.is_prescription ? (
                      <>
                        <span style={item.extracted?.patient_name ? styles.name : styles.nameUnknown}>
                          {item.extracted?.patient_name || "名前を読み取れず"}
                          {item.extracted?.patient_name && " 様"}
                        </span>
                        {item.extracted?.patient_kana && (
                          <span style={styles.kana}>{item.extracted.patient_kana}</span>
                        )}
                      </>
                    ) : (
                      <span style={styles.other}>送付状など(処方箋以外)</span>
                    )}
                  </span>
                  <span style={styles.badges}>
                    {item.needs_review && item.is_prescription && (
                      <span style={styles.badgeOrange}>要確認</span>
                    )}
                    {item.is_prescription &&
                      (item.printed_at ? (
                        <span style={styles.badgeGreen}>印刷済</span>
                      ) : (
                        <span style={styles.badgeGray}>未印刷</span>
                      ))}
                  </span>
                </button>
              ))}
            </section>
          );
        })
      )}

      {editing && (
        <Modal title="処方箋の確認・修正" onClose={() => setEditing(null)}>
          <form style={styles.form} onSubmit={saveEdit}>
            <div style={styles.infoBox}>
              <div>送信元: {editing.sender || "不明"}</div>
              <div>
                受信: {formatTime(editing.item.received_at)} / 原本{" "}
                {pagesLabel(editing.item.source_pages)}(全{editing.item.source_page_count}頁)
              </div>
            </div>
            <button type="button" style={styles.pdfButton} onClick={() => openPdf(editing.item)}>
              PDFを開く
            </button>

            <label style={styles.label}>
              患者名
              <input
                style={styles.input}
                value={editing.patient_name}
                onChange={(e) => setEditing({ ...editing, patient_name: e.target.value })}
              />
            </label>
            <label style={styles.label}>
              フリガナ
              <input
                style={styles.input}
                value={editing.patient_kana}
                onChange={(e) => setEditing({ ...editing, patient_kana: e.target.value })}
              />
            </label>
            <label style={styles.label}>
              生年月日
              <input
                style={styles.input}
                type="date"
                value={editing.birth_date}
                onChange={(e) => setEditing({ ...editing, birth_date: e.target.value })}
              />
            </label>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={!editing.is_prescription}
                onChange={(e) => setEditing({ ...editing, is_prescription: !e.target.checked })}
              />
              処方箋ではない(送付状など)
            </label>

            {saveError && <p style={styles.error}>{saveError}</p>}
            <button style={styles.button} type="submit">
              保存
            </button>
          </form>
        </Modal>
      )}

      {senderEdit && (
        <Modal title="送信元を修正" onClose={() => setSenderEdit(null)}>
          <form style={styles.form} onSubmit={saveSender}>
            <label style={styles.label}>
              送信元(医療機関名)
              <input
                style={styles.input}
                value={senderEdit.value}
                placeholder="例: ◯◯クリニック"
                onChange={(e) => setSenderEdit({ ...senderEdit, value: e.target.value })}
              />
            </label>
            <p style={styles.note}>このFAXの全員({senderEdit.rows.length}件)に反映されます</p>
            {saveError && <p style={styles.error}>{saveError}</p>}
            <button style={styles.button} type="submit">
              保存
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const badge = {
  fontSize: "0.7rem",
  borderRadius: "4px",
  padding: "0.15rem 0.4rem",
  whiteSpace: "nowrap",
};

const chipBase = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.35rem 0.7rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
  whiteSpace: "nowrap",
  cursor: "pointer",
  flexShrink: 0,
};

const styles = {
  container: { padding: "1rem", maxWidth: "720px", minWidth: 0 },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.7rem",
    flexWrap: "wrap",
  },
  heading: { fontSize: "1.2rem", margin: 0 },
  headerButtons: { display: "flex", gap: "0.4rem" },
  subButton: {
    padding: "0.4rem 0.8rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  searchBox: { position: "relative", marginBottom: "0.6rem" },
  searchInput: {
    width: "100%",
    padding: "0.6rem 2rem 0.6rem 0.7rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
  },
  clearButton: {
    position: "absolute",
    right: "0.4rem",
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    background: "none",
    fontSize: "1.1rem",
    color: "#888",
    cursor: "pointer",
  },
  chipRow: { display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "0.4rem" },
  chip: { ...chipBase, border: "1px solid #ccc", background: "#fff", color: "#333" },
  chipActive: { ...chipBase, border: "1px solid #2563eb", background: "#2563eb", color: "#fff" },
  chipCount: { fontSize: "0.7rem", opacity: 0.8 },
  calendarButton: {
    ...chipBase,
    position: "relative",
    border: "1px dashed #2563eb",
    background: "#fff",
    color: "#2563eb",
  },
  hiddenDate: { position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" },
  resultInfo: { fontSize: "0.8rem", color: "#666", margin: "0 0 0.6rem 0" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  muted: { color: "#888" },
  faxBlock: {
    background: "#fff",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    marginBottom: "0.8rem",
    overflow: "hidden",
  },
  faxHeader: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    width: "100%",
    padding: "0.65rem 0.9rem",
    background: "#eff6ff",
    border: "none",
    borderBottom: "1px solid #dbeafe",
    textAlign: "left",
    cursor: "pointer",
  },
  senderLine: { display: "flex", alignItems: "center", gap: "0.4rem" },
  sender: { fontWeight: 700, fontSize: "1rem", color: "#1e3a8a" },
  senderUnknown: { fontWeight: 700, fontSize: "1rem", color: "#c2410c" },
  editMark: { fontSize: "0.8rem", color: "#93a3c0" },
  faxMeta: { fontSize: "0.75rem", color: "#555" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
    width: "100%",
    padding: "0.65rem 0.9rem",
    background: "none",
    border: "none",
    borderBottom: "1px solid #f3f4f6",
    textAlign: "left",
    cursor: "pointer",
  },
  pages: {
    fontSize: "0.72rem",
    color: "#555",
    background: "#f3f4f6",
    borderRadius: "4px",
    padding: "0.15rem 0.35rem",
    minWidth: "3.2rem",
    textAlign: "center",
    flexShrink: 0,
  },
  main: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  name: { fontWeight: 700, fontSize: "0.95rem", color: "#111" },
  nameUnknown: { fontWeight: 700, fontSize: "0.9rem", color: "#c2410c" },
  kana: { fontSize: "0.72rem", color: "#888" },
  other: { fontSize: "0.85rem", color: "#888" },
  badges: { display: "flex", gap: "0.3rem", flexShrink: 0 },
  badgeGreen: { ...badge, background: "#ecfdf5", color: "#047857" },
  badgeGray: { ...badge, background: "#f3f4f6", color: "#555" },
  badgeOrange: { ...badge, background: "#fff7ed", color: "#c2410c" },
  badgeDemo: { ...badge, background: "#fef3c7", color: "#92400e" },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  infoBox: { background: "#f9fafb", borderRadius: "8px", padding: "0.6rem", fontSize: "0.8rem", color: "#555", lineHeight: 1.6 },
  pdfButton: {
    padding: "0.55rem",
    borderRadius: "6px",
    border: "1px solid #2563eb",
    background: "#fff",
    color: "#2563eb",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem", color: "#555" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" },
  checkRow: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" },
  note: { fontSize: "0.8rem", color: "#888", margin: 0 },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
};
