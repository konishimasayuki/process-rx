import { useEffect, useMemo, useState } from "react";

function formatTime(iso) {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pagesLabel(pages) {
  if (!pages || pages.length === 0) return "—";
  return pages.length === 1 ? `${pages[0]}頁` : `${pages[0]}-${pages[pages.length - 1]}頁`;
}

// 同じFAX(同じファイル・同じ受信時刻)ごとにまとめる
function groupByFax(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.filename}|${item.received_at}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.values()]
    .map((rows) => rows.sort((a, b) => (a.group_index || 0) - (b.group_index || 0)))
    .sort((a, b) => new Date(b[0].received_at) - new Date(a[0].received_at));
}

export default function FaxQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const faxes = useMemo(() => groupByFax(items), [items]);
  const hasDemo = items.some((i) => i.demo);

  async function toggleDemo() {
    setBusy(true);
    await fetch("/api/fax-demo", { method: hasDemo ? "DELETE" : "POST" });
    await load(true);
    setBusy(false);
  }

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
        <div style={styles.headerButtons}>
          <button style={styles.subButton} onClick={toggleDemo} disabled={busy}>
            {hasDemo ? "サンプルを消す" : "サンプル表示"}
          </button>
          <button style={styles.subButton} onClick={() => load()}>
            更新
          </button>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <p>読み込み中...</p>
      ) : faxes.length === 0 ? (
        <p style={styles.muted}>まだFAXを受信していません</p>
      ) : (
        faxes.map((rows) => {
          const first = rows[0];
          const patients = rows.filter((r) => r.is_prescription).length;
          return (
            <section key={`${first.filename}|${first.received_at}`} style={styles.faxBlock}>
              <div style={styles.faxHeader}>
                <span style={styles.faxTime}>{formatTime(first.received_at)} 受信</span>
                <span style={styles.faxMeta}>
                  全{first.source_page_count}頁 → {patients}名分
                </span>
                {first.demo && <span style={styles.badgeDemo}>サンプル</span>}
              </div>

              {rows.map((item) => (
                <button key={item.id} style={styles.row} onClick={() => openPdf(item)}>
                  <span style={styles.pages}>{pagesLabel(item.source_pages)}</span>
                  <span style={styles.main}>
                    {item.is_prescription ? (
                      <>
                        <span style={styles.name}>
                          {item.extracted?.patient_name || "(名前を読み取れず)"}
                        </span>
                        <span style={styles.inst}>
                          {item.extracted?.issuing_institution || "医療機関 不明"}
                        </span>
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
                    {!item.has_pdf && <span style={styles.badgeRed}>PDFなし</span>}
                  </span>
                </button>
              ))}
            </section>
          );
        })
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

const styles = {
  container: { padding: "1rem", maxWidth: "720px", minWidth: 0 },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.8rem",
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
  error: { color: "#dc2626", fontSize: "0.85rem" },
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
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.55rem 0.9rem",
    background: "#f9fafb",
    borderBottom: "1px solid #eee",
    flexWrap: "wrap",
  },
  faxTime: { fontWeight: 700, fontSize: "0.85rem" },
  faxMeta: { fontSize: "0.75rem", color: "#666" },
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
  inst: {
    fontSize: "0.75rem",
    color: "#2563eb",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  other: { fontSize: "0.85rem", color: "#888" },
  badges: { display: "flex", gap: "0.3rem", flexShrink: 0 },
  badgeGreen: { ...badge, background: "#ecfdf5", color: "#047857" },
  badgeGray: { ...badge, background: "#f3f4f6", color: "#555" },
  badgeOrange: { ...badge, background: "#fff7ed", color: "#c2410c" },
  badgeRed: { ...badge, background: "#fef2f2", color: "#dc2626" },
  badgeDemo: { ...badge, background: "#fef3c7", color: "#92400e" },
};
