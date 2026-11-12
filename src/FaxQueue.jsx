import { useEffect, useState } from "react";

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pagesLabel(item) {
  const pages = item.source_pages || [];
  if (pages.length === 0) return "—";
  const range =
    pages.length === 1 ? `${pages[0]}` : `${pages[0]}-${pages[pages.length - 1]}`;
  return `${range} / 全${item.source_page_count}頁`;
}

export default function FaxQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(silent) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/fax-list");
      if (!res.ok) {
        setError("読み込みに失敗しました");
      } else {
        const data = await res.json();
        setItems(data.items || []);
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
  }, []);

  function openPdf(item) {
    if (!item.has_pdf) {
      alert("このPDFは大きすぎて保存されていません");
      return;
    }
    window.open(`/api/fax-pdf?id=${encodeURIComponent(item.id)}`, "_blank");
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>FAX受信一覧</h2>
        <button style={styles.reloadButton} onClick={() => load()}>
          更新
        </button>
      </div>
      <p style={styles.help}>
        1通のFAXを患者さんごとに分け、A4横の左右2面にまとめたPDFです。行をタップすると開きます。
      </p>

      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <p>読み込み中...</p>
      ) : items.length === 0 ? (
        <p style={styles.muted}>まだFAXを受信していません</p>
      ) : (
        <div style={styles.list}>
          <div style={styles.headerGrid}>
            <span>受信</span>
            <span>患者名</span>
            <span>医療機関</span>
            <span>原本ページ</span>
            <span>状態</span>
          </div>
          {items.map((item) => (
            <button
              key={item.id}
              style={styles.row}
              onClick={() => openPdf(item)}
            >
              <span style={styles.colTime}>{formatTime(item.received_at)}</span>
              <span style={styles.colName}>
                {item.extracted?.patient_name || "(読み取れず)"}
              </span>
              <span style={styles.colInst}>
                {item.extracted?.issuing_institution || "—"}
              </span>
              <span style={styles.colPages}>{pagesLabel(item)}</span>
              <span style={styles.colStatus}>
                {!item.is_prescription && (
                  <span style={styles.badgeGray}>処方箋以外</span>
                )}
                {item.needs_review && item.is_prescription && (
                  <span style={styles.badgeOrange}>要確認</span>
                )}
                {!item.has_pdf && <span style={styles.badgeRed}>PDFなし</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMNS = "110px 130px 160px 120px 130px";

const styles = {
  container: { padding: "1rem", maxWidth: "100%", minWidth: 0 },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.4rem",
  },
  heading: { fontSize: "1.2rem", margin: 0 },
  reloadButton: {
    padding: "0.4rem 0.8rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  help: { fontSize: "0.8rem", color: "#888", margin: "0 0 0.8rem 0" },
  error: { color: "#dc2626", fontSize: "0.85rem" },
  muted: { color: "#888" },
  list: {
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  headerGrid: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "0.8rem",
    padding: "0.5rem 1rem",
    borderBottom: "2px solid #e5e7eb",
    background: "#f9fafb",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "#666",
    width: "max-content",
    minWidth: "100%",
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "0.8rem",
    alignItems: "center",
    padding: "0.7rem 1rem",
    background: "none",
    border: "none",
    borderBottom: "1px solid #f0f0f0",
    textAlign: "left",
    cursor: "pointer",
    width: "max-content",
    minWidth: "100%",
    fontSize: "0.85rem",
    whiteSpace: "nowrap",
  },
  colTime: { color: "#666" },
  colName: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  colInst: { color: "#2563eb", overflow: "hidden", textOverflow: "ellipsis" },
  colPages: { color: "#666", fontSize: "0.8rem" },
  colStatus: { display: "flex", gap: "0.3rem" },
  badgeGray: {
    fontSize: "0.65rem",
    background: "#f3f4f6",
    color: "#555",
    borderRadius: "4px",
    padding: "0.1rem 0.35rem",
  },
  badgeOrange: {
    fontSize: "0.65rem",
    background: "#fff7ed",
    color: "#c2410c",
    borderRadius: "4px",
    padding: "0.1rem 0.35rem",
  },
  badgeRed: {
    fontSize: "0.65rem",
    background: "#fef2f2",
    color: "#dc2626",
    borderRadius: "4px",
    padding: "0.1rem 0.35rem",
  },
};
