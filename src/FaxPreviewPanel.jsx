import { useEffect, useRef, useState } from "react";

const clampZoom = (z) => Math.round(Math.min(2, Math.max(0.5, z)) * 100) / 100;

// 合体したPDFのプレビュー。見る大きさ(拡大表示)と、印刷の大きさ(自動フィット/全体・拡大率)を変えられる
export default function FaxPreviewPanel({ item, onItemUpdated }) {
  const kind = item.kind || (item.is_prescription ? "prescription" : "cover");
  const canAdjust = kind !== "ad"; // 広告は合体せず元のまま
  const sheets = Math.min(item.sheet_count || 1, 6);

  const [viewZoom, setViewZoom] = useState(1); // 画面で見る拡大(1=幅いっぱい)
  const [layout, setLayout] = useState(item.layout || { fit: "auto", zoom: 1 });
  const [version, setVersion] = useState(item.pdf_updated_at || item.edited_at || item.received_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function apply(next) {
    setLayout(next);
    setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/fax-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, fit: next.fit, zoom: next.zoom }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "作り直しに失敗しました");
        } else {
          setVersion(data.item.pdf_updated_at);
          setFailed(false);
          onItemUpdated(data.item);
        }
      } catch {
        setError("通信エラーが発生しました");
      }
      setBusy(false);
    }, 350);
  }

  const percent = Math.round(layout.zoom * 100);
  const src = (page) =>
    `/api/fax-preview?id=${encodeURIComponent(item.id)}&page=${page}&w=1300&v=${encodeURIComponent(version || "")}`;

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <span style={styles.toolLabel}>見る大きさ</span>
        <button type="button" style={styles.toolButton} onClick={() => setViewZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))}>
          −
        </button>
        <span style={styles.percent}>{Math.round(viewZoom * 100)}%</span>
        <button type="button" style={styles.toolButton} onClick={() => setViewZoom((z) => Math.min(4, +(z + 0.5).toFixed(2)))}>
          ＋
        </button>
        <button type="button" style={styles.textButton} onClick={() => setViewZoom(1)}>
          全体
        </button>
      </div>

      <div style={styles.viewer}>
        {failed ? (
          <p style={styles.failed}>プレビューを表示できません。下の「PDFを開く」をお使いください。</p>
        ) : (
          Array.from({ length: sheets }, (_, i) => (
            <img
              key={`${i}-${version}`}
              alt={`プレビュー ${i + 1}`}
              src={src(i + 1)}
              style={{ ...styles.image, width: `${viewZoom * 100}%`, opacity: busy ? 0.5 : 1 }}
              onError={() => setFailed(true)}
            />
          ))
        )}
        {busy && <div style={styles.busy}>作り直し中…</div>}
      </div>

      {canAdjust && (
        <div style={styles.layoutBox}>
          <div style={styles.layoutTitle}>印刷の大きさ(印刷にも反映されます)</div>
          <div style={styles.segment}>
            <button
              type="button"
              style={layout.fit === "auto" ? styles.segActive : styles.seg}
              onClick={() => apply({ ...layout, fit: "auto" })}
            >
              自動フィット
            </button>
            <button
              type="button"
              style={layout.fit === "full" ? styles.segActiveRight : styles.segRight}
              onClick={() => apply({ ...layout, fit: "full" })}
            >
              ページ全体
            </button>
          </div>
          <div style={styles.zoomRow}>
            <span style={styles.toolLabel}>拡大率</span>
            <button type="button" style={styles.toolButton} onClick={() => apply({ ...layout, zoom: clampZoom(layout.zoom - 0.1) })}>
              −
            </button>
            <span style={styles.percent}>{percent}%</span>
            <button type="button" style={styles.toolButton} onClick={() => apply({ ...layout, zoom: clampZoom(layout.zoom + 0.1) })}>
              ＋
            </button>
            <button type="button" style={styles.textButton} onClick={() => apply({ fit: "auto", zoom: 1 })}>
              元に戻す
            </button>
          </div>
          <p style={styles.hint}>文字がはみ出すときは「−」、余白が大きいときは「＋」を押してください。</p>
          {error && <p style={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}

const btn = {
  minWidth: "2.2rem",
  height: "2.2rem",
  borderRadius: "6px",
  border: "1px solid #ccc",
  background: "#fff",
  fontSize: "1.05rem",
  cursor: "pointer",
};
const seg = { flex: 1, padding: "0.5rem", border: "1px solid #ccc", background: "#fff", fontSize: "0.85rem", cursor: "pointer" };

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  toolbar: { display: "flex", alignItems: "center", gap: "0.4rem" },
  toolLabel: { fontSize: "0.78rem", color: "#555", minWidth: "4.5rem" },
  toolButton: btn,
  textButton: { border: "none", background: "none", color: "#2563eb", fontSize: "0.8rem", cursor: "pointer", padding: "0 0.3rem" },
  percent: { minWidth: "3.2rem", textAlign: "center", fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" },
  viewer: {
    position: "relative",
    maxHeight: "46vh",
    overflow: "auto",
    background: "#e5e7eb",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    WebkitOverflowScrolling: "touch",
  },
  image: { display: "block", maxWidth: "none", background: "#fff", margin: "0 0 2px 0" },
  busy: {
    position: "absolute",
    top: "0.5rem",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(17,24,39,0.8)",
    color: "#fff",
    fontSize: "0.8rem",
    padding: "0.3rem 0.8rem",
    borderRadius: "999px",
  },
  failed: { padding: "1rem", fontSize: "0.85rem", color: "#666" },
  layoutBox: { background: "#f9fafb", borderRadius: "8px", padding: "0.7rem", display: "flex", flexDirection: "column", gap: "0.5rem" },
  layoutTitle: { fontSize: "0.8rem", fontWeight: 700, color: "#333" },
  segment: { display: "flex" },
  seg: { ...seg, borderRadius: "6px 0 0 6px" },
  segActive: { ...seg, borderRadius: "6px 0 0 6px", background: "#2563eb", color: "#fff", borderColor: "#2563eb" },
  zoomRow: { display: "flex", alignItems: "center", gap: "0.4rem" },
  hint: { fontSize: "0.72rem", color: "#888", margin: 0 },
  error: { fontSize: "0.8rem", color: "#dc2626", margin: 0 },
};
styles.segRight = { ...seg, borderRadius: "0 6px 6px 0", borderLeft: "none" };
styles.segActiveRight = { ...styles.segRight, background: "#2563eb", color: "#fff", borderColor: "#2563eb" };
