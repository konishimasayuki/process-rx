import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import FloatingAddButton from "./FloatingAddButton.jsx";

const EMPTY_FORM = { facility_name: "", name: "", yomi: "", address: "", notes: "" };

function normalizeKana(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

export default function DestinationsList() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/destinations");
    const data = await res.json();
    setDestinations(data.destinations || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeKana(search.trim());
    if (!q) return destinations;
    return destinations.filter((d) =>
      [d.facility_name, d.name, d.yomi, d.address, d.notes]
        .filter(Boolean)
        .some((field) => normalizeKana(field).includes(q))
    );
  }, [destinations, search]);

  function openAddModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEditModal(dest) {
    setEditingId(dest.id);
    setForm({
      facility_name: dest.facility_name || "",
      name: dest.name || "",
      yomi: dest.yomi || "",
      address: dest.address || "",
      notes: dest.notes || "",
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.name || !form.address) {
      setError("氏名と住所は必須です");
      return;
    }

    setSaving(true);
    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { ...form, id: editingId } : form;

    const res = await fetch("/api/destinations", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "保存に失敗しました");
      setSaving(false);
      return;
    }

    const data = await res.json();
    const saved = data.destination;

    setDestinations((prev) => {
      const withoutOld = prev.filter((d) => d.id !== saved.id);
      return [...withoutOld, saved].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", "ja")
      );
    });

    setSaving(false);
    setModalOpen(false);
  }

  async function handleDelete(id) {
    if (!confirm("この配達先を削除しますか？")) return;
    await fetch("/api/destinations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDestinations((prev) => prev.filter((d) => d.id !== id));
    setModalOpen(false);
  }

  function handleExport() {
    window.open("/api/destinations-export", "_blank");
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult("");

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/destinations-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: reader.result }),
        });
        const data = await res.json();
        if (!res.ok) {
          setImportResult(data.error || "インポートに失敗しました");
        } else {
          setImportResult(
            `完了: 新規${data.created}件 / 更新${data.updated}件` +
              (data.skipped ? ` / スキップ${data.skipped}件` : "")
          );
          load();
        }
      } catch {
        setImportResult("インポートに失敗しました");
      }
      setImporting(false);
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>配達先一覧</h2>

      <div style={styles.toolbarRow}>
        <input
          style={styles.search}
          placeholder="施設名・氏名・ヨミ・住所・備考で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={styles.csvButtons}>
          <button style={styles.csvButton} onClick={handleExport}>
            CSV書き出し
          </button>
          <button
            style={styles.csvButton}
            onClick={handleImportClick}
            disabled={importing}
          >
            {importing ? "取込中..." : "CSV取込"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
      </div>

      {importResult && <p style={styles.importResult}>{importResult}</p>}

      {loading ? (
        <p>読み込み中...</p>
      ) : filtered.length === 0 ? (
        <p style={styles.muted}>該当する配達先がありません</p>
      ) : (
        <div style={styles.list}>
          {filtered.map((dest) => (
            <button
              key={dest.id}
              style={styles.row}
              onClick={() => openEditModal(dest)}
            >
              <span style={styles.rowFacility}>{dest.facility_name || "—"}</span>
              <span style={styles.rowName}>{dest.name}様</span>
              {dest.yomi && <span style={styles.rowYomi}>{dest.yomi}</span>}
              <span style={styles.rowAddress}>{dest.address}</span>
              <span style={styles.rowNotes}>{dest.notes}</span>
              {dest.lat == null && <span style={styles.geoWarning}>位置未取得</span>}
            </button>
          ))}
        </div>
      )}

      <FloatingAddButton onClick={openAddModal} />

      {modalOpen && (
        <Modal
          title={editingId ? "配達先を編集" : "配達先を追加"}
          onClose={() => setModalOpen(false)}
        >
          <form style={styles.form} onSubmit={handleSubmit}>
            <input
              style={styles.input}
              placeholder="施設名(任意)"
              value={form.facility_name}
              onChange={(e) => setForm({ ...form, facility_name: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="氏名"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="ヨミ(任意・検索用)"
              value={form.yomi}
              onChange={(e) => setForm({ ...form, yomi: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="住所"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="備考(任意)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.formButtons}>
              <button style={styles.button} type="submit" disabled={saving}>
                {editingId ? "更新" : "追加"}
              </button>
              {editingId && (
                <button
                  type="button"
                  style={styles.dangerButton}
                  onClick={() => handleDelete(editingId)}
                >
                  削除
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "100%" },
  heading: { fontSize: "1.2rem", marginBottom: "0.8rem" },
  toolbarRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "0.5rem",
    alignItems: "center",
  },
  search: {
    flex: 1,
    minWidth: "200px",
    maxWidth: "480px",
    padding: "0.6rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
    boxSizing: "border-box",
  },
  csvButtons: { display: "flex", gap: "0.4rem" },
  csvButton: {
    padding: "0.5rem 0.8rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.8rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  importResult: {
    fontSize: "0.85rem",
    color: "#16a34a",
    marginBottom: "0.8rem",
  },
  muted: { color: "#888" },
  list: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    background: "#fff",
    borderRadius: "10px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.8rem",
    padding: "0.6rem 1rem",
    borderBottom: "1px solid #f0f0f0",
    background: "none",
    border: "none",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "#f0f0f0",
    textAlign: "left",
    cursor: "pointer",
    width: "max-content",
    minWidth: "100%",
    fontSize: "0.85rem",
    whiteSpace: "nowrap",
  },
  rowFacility: { color: "#2563eb", flexShrink: 0, minWidth: "80px" },
  rowName: { fontWeight: 600, flexShrink: 0, minWidth: "90px" },
  rowYomi: { color: "#999", fontSize: "0.75rem", flexShrink: 0, minWidth: "70px" },
  rowAddress: { color: "#555", flex: 1, minWidth: "160px" },
  rowNotes: { color: "#999", flexShrink: 0, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" },
  geoWarning: { color: "#d97706", fontSize: "0.7rem", flexShrink: 0 },

  form: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  formButtons: { display: "flex", gap: "0.5rem", marginTop: "0.3rem" },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  dangerButton: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
};
