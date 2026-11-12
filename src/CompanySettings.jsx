import { useEffect, useState } from "react";

// 出勤・退勤できる場所(会社の住所と範囲)
export default function CompanySettings() {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/company")
      .then((r) => r.json())
      .then((d) => d.company && setForm({ address: d.company.address, radius_m: d.company.radius_m, located: d.company.lat != null }))
      .catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: form.address, radius_m: form.radius_m }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(json.error || "保存に失敗しました");
    setForm({ ...form, located: true });
    setMessage("保存しました");
  }

  if (!form) return null;
  return (
    <section style={styles.section}>
      <h3 style={styles.title}>タイムカードの打刻場所</h3>
      <p style={styles.help}>この住所から範囲内なら出勤・退勤できます。範囲外では理由の入力が必要です。</p>
      <form style={styles.form} onSubmit={save}>
        <label style={styles.label}>
          会社の住所
          <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label style={styles.label}>
          範囲(m)
          <input style={{ ...styles.input, width: "8rem" }} type="number" min="30" max="5000" value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} />
        </label>
        {!form.located && <p style={styles.warn}>まだ住所の位置が特定できていません(Google Mapsのキーを確認してください)</p>}
        {message && <p style={styles.message}>{message}</p>}
        <button style={styles.button} type="submit">保存</button>
      </form>
    </section>
  );
}

const styles = {
  section: { background: "#fff", borderRadius: "10px", padding: "1rem", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", marginBottom: "1rem" },
  title: { fontSize: "0.95rem", marginBottom: "0.4rem" },
  help: { fontSize: "0.8rem", color: "#888", marginBottom: "0.8rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.85rem", color: "#333" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.9rem" },
  warn: { color: "#c2410c", fontSize: "0.8rem", margin: 0 },
  message: { color: "#16a34a", fontSize: "0.85rem", margin: 0 },
  button: { padding: "0.6rem 1rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.9rem", cursor: "pointer", alignSelf: "flex-start" },
};
