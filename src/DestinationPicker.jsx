import { useEffect, useMemo, useRef, useState } from "react";

// カタカナをひらがなに変換して、ひらがな/カタカナどちらで打っても一致するようにする
function normalizeKana(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

function destinationLabel(dest) {
  return dest.facility_name ? `${dest.facility_name} ${dest.name}様` : `${dest.name}様`;
}

export default function DestinationPicker({ destinations, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = destinations.find((d) => d.id === value) || null;

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeKana(query.trim());
    if (!q) return destinations.slice(0, 50);
    return destinations
      .filter((d) =>
        [d.facility_name, d.name].filter(Boolean).some((f) =>
          normalizeKana(f).includes(q)
        )
      )
      .slice(0, 50);
  }, [destinations, query]);

  function handleSelect(dest) {
    onChange(dest.id);
    setQuery("");
    setOpen(false);
  }

  function handleClear() {
    onChange("");
    setQuery("");
  }

  return (
    <div style={styles.container} ref={containerRef}>
      {selected && !open ? (
        <button
          type="button"
          style={styles.selectedButton}
          onClick={() => setOpen(true)}
        >
          <span>{destinationLabel(selected)}</span>
          <span style={styles.clearIcon} onClick={(e) => { e.stopPropagation(); handleClear(); }}>
            ×
          </span>
        </button>
      ) : (
        <input
          style={styles.input}
          placeholder="施設名・氏名で検索(ひらがな/カタカナ可)"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      )}

      {open && (
        <div style={styles.dropdown}>
          {filtered.length === 0 ? (
            <div style={styles.noResult}>該当する配達先がありません</div>
          ) : (
            filtered.map((dest) => (
              <button
                key={dest.id}
                type="button"
                style={styles.option}
                onClick={() => handleSelect(dest)}
              >
                {destinationLabel(dest)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { position: "relative" },
  input: {
    width: "100%",
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
    boxSizing: "border-box",
  },
  selectedButton: {
    width: "100%",
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
    background: "#fff",
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxSizing: "border-box",
  },
  clearIcon: {
    color: "#999",
    fontSize: "1.1rem",
    paddingLeft: "0.5rem",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    maxHeight: "220px",
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: "8px",
    marginTop: "0.3rem",
    boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
    zIndex: 60,
  },
  option: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.6rem 0.8rem",
    border: "none",
    borderBottom: "1px solid #f0f0f0",
    background: "#fff",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  noResult: { padding: "0.6rem 0.8rem", color: "#888", fontSize: "0.85rem" },
};
