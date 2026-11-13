import { useMemo, useState } from "react";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#4b5563"];

// 1通のFAXのページのまとめ方(どこで人が切り替わるか)を、人が直す画面
export default function FaxRegroup({ rows, onDone, onCancel }) {
  const faxId = rows[0].fax_id;
  const pages = useMemo(() => [...new Set(rows.flatMap((r) => r.source_pages || []))].sort((a, b) => a - b), [rows]);
  const itemOfPage = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => (r.source_pages || []).forEach((n) => m.set(n, r)));
    return m;
  }, [rows]);
  const turnOf = (n) => itemOfPage.get(n)?.turns?.[String(n)] || 0;

  // cuts[i] = true なら、pages[i] と pages[i+1] の間で別の人に切り替わる
  const [cuts, setCuts] = useState(() => pages.slice(0, -1).map((n, i) => itemOfPage.get(n) !== itemOfPage.get(pages[i + 1])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => {
    const out = [[pages[0]]];
    for (let i = 1; i < pages.length; i++) {
      if (cuts[i - 1]) out.push([pages[i]]);
      else out[out.length - 1].push(pages[i]);
    }
    return out;
  }, [pages, cuts]);

  const groupLabel = (g) => {
    const same = rows.find((r) => (r.source_pages || []).join(",") === g.join(","));
    if (same) {
      const kind = same.kind || (same.is_prescription ? "prescription" : "cover");
      if (kind === "cover") return "送付状など";
      if (kind === "ad") return "広告・宣伝";
      return same.extracted?.patient_name ? `${same.extracted.patient_name} 様` : "名前を読み取れず";
    }
    return "変更あり(保存するとAIが読み直します)";
  };

  const changed = groups.map((g) => g.join(",")).join("|") !== rows.map((r) => r.source_pages.join(",")).join("|");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/fax-regroup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fax_id: faxId, groups }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "保存に失敗しました");
        setSaving(false);
        return;
      }
      onDone(data.items || []);
    } catch {
      setError("通信エラーが発生しました");
      setSaving(false);
    }
  }

  let groupIndex = -1;
  return (
    <div style={styles.wrap}>
      <p style={styles.help}>
        ページの間のボタンで、同じ人なら「つなぐ」、別の人なら「分ける」にしてください。
      </p>

      <div style={styles.list}>
        {pages.map((n, i) => {
          const startsGroup = i === 0 || cuts[i - 1];
          if (startsGroup) groupIndex += 1;
          const color = COLORS[groupIndex % COLORS.length];
          const group = groups[groupIndex];
          return (
            <div key={n}>
              {startsGroup && (
                <div style={{ ...styles.groupHead, borderColor: color, color }}>
                  {groupIndex + 1}. {groupLabel(group)}
                  <span style={styles.groupPages}>({group.length}ページ)</span>
                </div>
              )}
              <div style={{ ...styles.page, borderLeftColor: color }}>
                <img
                  alt={`${n}頁`}
                  style={styles.thumb}
                  src={`/api/fax-preview?fax_id=${encodeURIComponent(faxId)}&src_page=${n}&turn=${turnOf(n)}&w=360`}
                />
                <span style={styles.pageNo}>{n}頁</span>
              </div>
              {i < pages.length - 1 && (
                <button
                  type="button"
                  style={cuts[i] ? styles.cutButton : styles.joinButton}
                  onClick={() => setCuts(cuts.map((c, j) => (j === i ? !c : c)))}
                >
                  {cuts[i] ? "✂ ここで別の人(タップでつなぐ)" : "🔗 同じ人(タップで分ける)"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      <div style={styles.buttons}>
        <button type="button" style={styles.cancel} onClick={onCancel} disabled={saving}>
          やめる
        </button>
        <button type="button" style={styles.save} onClick={save} disabled={!changed || saving}>
          {saving ? "保存してAIが読み直しています…" : "この分け方で保存"}
        </button>
      </div>
      {saving && <p style={styles.note}>20〜30秒ほどかかることがあります。そのままお待ちください。</p>}
    </div>
  );
}

const btn = { width: "100%", padding: "0.5rem", margin: "0.4rem 0", borderRadius: "8px", fontSize: "0.85rem", cursor: "pointer" };
const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  help: { fontSize: "0.82rem", color: "#555", margin: 0, lineHeight: 1.6 },
  list: { display: "flex", flexDirection: "column" },
  groupHead: { fontWeight: 700, fontSize: "0.9rem", borderBottom: "2px solid", padding: "0.3rem 0", marginTop: "0.4rem" },
  groupPages: { fontWeight: 400, fontSize: "0.75rem", color: "#666", marginLeft: "0.4rem" },
  page: { display: "flex", alignItems: "center", gap: "0.7rem", borderLeft: "5px solid", paddingLeft: "0.6rem", marginTop: "0.4rem" },
  thumb: { width: "45%", maxWidth: "170px", border: "1px solid #d1d5db", background: "#fff", borderRadius: "4px" },
  pageNo: { fontSize: "0.9rem", fontWeight: 700, color: "#333" },
  joinButton: { ...btn, border: "1px dashed #93c5fd", background: "#eff6ff", color: "#1e40af" },
  cutButton: { ...btn, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 700 },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
  buttons: { display: "flex", gap: "0.5rem" },
  cancel: { flex: 1, padding: "0.7rem", borderRadius: "8px", border: "1px solid #ccc", background: "#fff", cursor: "pointer" },
  save: { flex: 2, padding: "0.7rem", borderRadius: "8px", border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" },
  note: { fontSize: "0.78rem", color: "#888", margin: 0 },
};
