export default function FloatingAddButton({ onClick }) {
  return (
    <button style={styles.fab} onClick={onClick} aria-label="追加">
      +
    </button>
  );
}

const styles = {
  fab: {
    position: "fixed",
    right: "1.5rem",
    bottom: "1.5rem",
    width: "3.2rem",
    height: "3.2rem",
    borderRadius: "50%",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "1.8rem",
    lineHeight: 1,
    boxShadow: "0 4px 14px rgba(37,99,235,0.4)",
    cursor: "pointer",
    zIndex: 40,
  },
};
