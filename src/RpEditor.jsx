// 処方の項(Rp)の編集: (1)(2)…ごとに、薬(名前・量)と用法・日数
const emptyDrug = () => ({ name: "", amount: "" });
const emptyRp = () => ({ drugs: [emptyDrug()], usage: "", days: "" });

// 古い読み取り結果(薬ごとのリスト)を項の形にそろえる
export function toRps(extracted) {
  if (Array.isArray(extracted?.rps)) {
    return extracted.rps.map((rp) => ({
      drugs: (rp.drugs || []).map((d) => ({ name: d.name || "", amount: d.amount || "" })),
      usage: rp.usage || "",
      days: rp.days || "",
    }));
  }
  if (Array.isArray(extracted?.drugs)) {
    return extracted.drugs.map((d) => ({
      drugs: [{ name: d.name || "", amount: d.dosage || "" }],
      usage: d.usage || "",
      days: d.days_or_quantity || "",
    }));
  }
  return [];
}

export default function RpEditor({ value, onChange }) {
  const rps = value || [];
  const update = (i, patch) => onChange(rps.map((rp, j) => (j === i ? { ...rp, ...patch } : rp)));
  const updateDrug = (i, k, patch) =>
    update(i, { drugs: rps[i].drugs.map((d, j) => (j === k ? { ...d, ...patch } : d)) });

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>処方内容</div>
      {rps.length === 0 && <p style={styles.empty}>読み取れた処方はありません。「＋ 項を追加」で入力できます。</p>}

      {rps.map((rp, i) => (
        <div key={i} style={styles.rp}>
          <div style={styles.rpHead}>
            <span style={styles.rpNo}>({i + 1})</span>
            <button
              type="button"
              style={styles.removeRp}
              onClick={() => {
                if (window.confirm(`(${i + 1})の項を削除しますか？`)) onChange(rps.filter((_, j) => j !== i));
              }}
            >
              この項を削除
            </button>
          </div>

          {rp.drugs.map((d, k) => (
            <div key={k} style={styles.drugRow}>
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="薬品名"
                value={d.name}
                onChange={(e) => updateDrug(i, k, { name: e.target.value })}
              />
              <input
                style={{ ...styles.input, width: "4.8rem" }}
                placeholder="量"
                value={d.amount}
                onChange={(e) => updateDrug(i, k, { amount: e.target.value })}
              />
              <button
                type="button"
                style={styles.removeDrug}
                aria-label="薬を削除"
                onClick={() => update(i, { drugs: rp.drugs.filter((_, j) => j !== k) })}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" style={styles.addDrug} onClick={() => update(i, { drugs: [...rp.drugs, emptyDrug()] })}>
            ＋ 薬を追加
          </button>

          <div style={styles.drugRow}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="用法(例: 1日2回朝夕食後)"
              value={rp.usage}
              onChange={(e) => update(i, { usage: e.target.value })}
            />
            <input
              style={{ ...styles.input, width: "6rem" }}
              placeholder="日数(例: 14日分)"
              value={rp.days}
              onChange={(e) => update(i, { days: e.target.value })}
            />
          </div>
        </div>
      ))}

      <button type="button" style={styles.addRp} onClick={() => onChange([...rps, emptyRp()])}>
        ＋ 項を追加
      </button>
    </div>
  );
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  title: { fontSize: "0.85rem", fontWeight: 700, color: "#333" },
  empty: { fontSize: "0.8rem", color: "#888", margin: 0 },
  rp: { border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.55rem", display: "flex", flexDirection: "column", gap: "0.4rem", background: "#fcfcfd" },
  rpHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  rpNo: { fontWeight: 700, color: "#1e3a8a" },
  removeRp: { border: "none", background: "none", color: "#dc2626", fontSize: "0.75rem", cursor: "pointer" },
  drugRow: { display: "flex", gap: "0.35rem", alignItems: "center" },
  input: { padding: "0.45rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.9rem", minWidth: 0 },
  removeDrug: { border: "none", background: "none", color: "#dc2626", fontSize: "1.1rem", cursor: "pointer", padding: "0 0.2rem" },
  addDrug: { alignSelf: "flex-start", border: "none", background: "none", color: "#2563eb", fontSize: "0.8rem", cursor: "pointer", padding: 0 },
  addRp: { padding: "0.45rem", borderRadius: "6px", border: "1px dashed #2563eb", background: "#fff", color: "#2563eb", fontSize: "0.85rem", cursor: "pointer" },
};
