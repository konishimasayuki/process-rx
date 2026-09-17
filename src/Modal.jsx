export default function Modal({ title, onClose, children }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.box} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{title}</h3>
          <button style={styles.closeButton} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: "1rem",
  },
  box: {
    background: "#fff",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "420px",
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1rem 1rem 0.5rem 1rem",
  },
  title: { margin: 0, fontSize: "1.05rem" },
  closeButton: {
    background: "none",
    border: "none",
    fontSize: "1.3rem",
    lineHeight: 1,
    cursor: "pointer",
    color: "#666",
  },
  body: { padding: "0 1rem 1rem 1rem" },
};
