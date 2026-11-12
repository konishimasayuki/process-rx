// YES / NO を聞くポップアップ
export default function ConfirmDialog({ title, message, yesLabel = "はい", noLabel = "いいえ", onYes, onNo }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.box}>
        <div style={styles.title}>{title}</div>
        {message && <div style={styles.message}>{message}</div>}
        <div style={styles.buttons}>
          <button style={styles.no} onClick={onNo}>
            {noLabel}
          </button>
          <button style={styles.yes} onClick={onYes}>
            {yesLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 300,
    padding: "1.5rem",
  },
  box: { background: "#fff", borderRadius: "14px", width: "100%", maxWidth: "340px", padding: "1.3rem", textAlign: "center" },
  title: { fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem" },
  message: { fontSize: "0.9rem", color: "#555", marginBottom: "0.4rem", lineHeight: 1.6 },
  buttons: { display: "flex", gap: "0.6rem", marginTop: "1rem" },
  no: { flex: 1, padding: "0.8rem", borderRadius: "10px", border: "1px solid #ccc", background: "#fff", fontSize: "1rem", cursor: "pointer" },
  yes: { flex: 1, padding: "0.8rem", borderRadius: "10px", border: "none", background: "#2563eb", color: "#fff", fontSize: "1rem", fontWeight: 700, cursor: "pointer" },
};
