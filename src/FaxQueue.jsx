import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import FaxPreviewPanel from "./FaxPreviewPanel.jsx";
import FaxPrintButton from "./FaxPrintButton.jsx";
import RpEditor, { toRps } from "./RpEditor.jsx";
import FaxRegroup from "./FaxRegroup.jsx";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatTime(iso) {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(dateStr, today) {
  const d = new Date(`${dateStr}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function pagesLabel(pages) {
  if (!pages || pages.length === 0) return "—";
  return pages.length === 1 ? `${pages[0]}頁` : `${pages[0]}-${pages[pages.length - 1]}頁`;
}

const KIND_LABELS = { prescription: "処方箋", cover: "送付状など", ad: "広告・宣伝" };
const kindOf = (item) => item.kind || (item.is_prescription ? "prescription" : "cover");
// 自動印刷の対象か(広告以外。古い記録は処方箋だけ)
const autoPrintOf = (item) => (item.auto_print !== undefined ? !!item.auto_print : !!item.is_prescription);

// 画面に表示する時刻(取り込んだ過去分は元の受信時刻)
function displayTime(item) {
  return new Date(item.imported && item.original_time ? item.original_time : item.received_at);
}

// 1通のFAXごとにまとめる(送信元は1通につき1つ)
function groupByFax(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.fax_id || `${item.filename}|${item.received_at}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.values()]
    .map((rows) => rows.sort((a, b) => (a.group_index || 0) - (b.group_index || 0)))
    .sort((a, b) => displayTime(b[0]) - displayTime(a[0]));
}

function senderOf(rows) {
  const explicit = rows.find((r) => r.sender)?.sender;
  if (explicit) return explicit;
  return rows.find((r) => r.extracted?.issuing_institution)?.extracted.issuing_institution || null;
}

export default function FaxQueue({ canManage = false }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [today, setToday] = useState(null);
  const [date, setDate] = useState(null); // null = 今日
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // 患者さんの修正
  const [senderEdit, setSenderEdit] = useState(null); // 送信元の修正
  const [regroupRows, setRegroupRows] = useState(null); // ページのまとめ方の修正
  const [saveError, setSaveError] = useState("");
  const searchTimer = useRef(null);
  const [importOpen, setImportOpen] = useState(false);
  const [agent, setAgent] = useState(null); // {heartbeat, command}
  const [importCount, setImportCount] = useState(5);
  const [importError, setImportError] = useState("");
  // 30秒ごとの自動更新でも、いま見ている日付・検索語を使うために保持
  const queryRef = useRef("");
  const dateRef = useRef(null);
  queryRef.current = query;
  dateRef.current = date;

  async function load(silent, opts = {}) {
    const q = opts.query !== undefined ? opts.query : queryRef.current;
    const d = opts.date !== undefined ? opts.date : dateRef.current;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      else if (d) params.set("date", d);
      const res = await fetch(`/api/fax-list?${params}`);
      if (!res.ok) {
        setError("読み込みに失敗しました");
      } else {
        const data = await res.json();
        setItems(data.items || []);
        setCounts(data.counts || {});
        setToday(data.today);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearchChange(value) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(false, { query: value }), 400);
  }

  function selectDate(d) {
    const next = d === today ? null : d;
    setQuery("");
    setDate(next);
    load(false, { query: "", date: next });
  }

  const faxes = useMemo(() => groupByFax(items), [items]);
  const hasDemo = items.some((i) => i.demo);
  const selected = date || today;
  const last7 = Object.keys(counts);
  const searching = query.trim().length > 0;

  async function toggleDemo() {
    setBusy(true);
    await fetch("/api/fax-demo", { method: hasDemo ? "DELETE" : "POST" });
    setQuery("");
    setDate(null);
    await load(true, { query: "", date: null });
    setBusy(false);
  }

  function openPdf(item) {
    if (!item.has_pdf) {
      alert("このPDFは大きすぎて保存されていません");
      return;
    }
    window.open(`/api/fax-pdf?id=${encodeURIComponent(item.id)}`, "_blank");
  }

  function applyUpdated(updated) {
    const map = new Map(updated.map((u) => [u.id, u]));
    setItems((prev) => prev.map((p) => map.get(p.id) || p));
  }

  function openEdit(item, rows) {
    setSaveError("");
    setEditing({
      item,
      sender: senderOf(rows),
      patient_name: item.extracted?.patient_name || "",
      patient_kana: item.extracted?.patient_kana || "",
      birth_date: item.extracted?.birth_date || "",
      insurer_number: item.extracted?.insurer_number || "",
      insured_symbol_number: item.extracted?.insured_symbol_number || "",
      rps: toRps(item.extracted),
      kind: kindOf(item),
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const res = await fetch("/api/fax-edit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editing.item.id,
        patient_name: editing.patient_name,
        patient_kana: editing.patient_kana,
        birth_date: editing.birth_date,
        kind: editing.kind,
        ...(editing.kind === "prescription"
          ? {
              insurer_number: editing.insurer_number,
              insured_symbol_number: editing.insured_symbol_number,
              rps: editing.rps,
            }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setSaveError(data.error || "保存に失敗しました");
    applyUpdated([data.item]);
    setEditing(null);
  }

  async function saveSender(e) {
    e.preventDefault();
    const res = await fetch("/api/fax-edit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: senderEdit.rows.map((r) => r.id), sender: senderEdit.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setSaveError(data.error || "保存に失敗しました");
    applyUpdated(data.items || []);
    setSenderEdit(null);
  }

  async function loadAgent() {
    const res = await fetch("/api/fax-agent");
    if (res.ok) setAgent(await res.json());
  }

  const commandActive = agent?.command && ["pending", "running"].includes(agent.command.status);

  // 取込の依頼中・実行中は、進み具合を3秒ごとに確認し、終わったら一覧を更新する
  useEffect(() => {
    if (!importOpen || !commandActive) return undefined;
    const t = setInterval(async () => {
      const res = await fetch("/api/fax-agent");
      if (!res.ok) return;
      const next = await res.json();
      setAgent(next);
      if (next.command && !["pending", "running"].includes(next.command.status)) {
        load(true, { query: "", date: null });
      }
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOpen, commandActive]);

  function openImport() {
    setImportError("");
    setImportOpen(true);
    loadAgent();
  }

  async function startImport() {
    setImportError("");
    const res = await fetch("/api/fax-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "import_existing", count: importCount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setImportError(data.error || "依頼に失敗しました");
    setQuery("");
    setDate(null);
    loadAgent();
  }

  async function deleteRequest(body, confirmText) {
    if (!window.confirm(confirmText)) return false;
    setBusy(true);
    const res = await fetch("/api/fax-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setSaveError(data.error || "削除に失敗しました");
      return false;
    }
    await load(true);
    return true;
  }

  async function deleteAll() {
    await deleteRequest(
      { all: true },
      "受信一覧のFAXをすべて削除します。合体PDFも消え、元に戻せません。よろしいですか？"
    );
  }

  async function deleteFax(rows) {
    const ok = await deleteRequest(
      { fax_id: rows[0].fax_id || undefined, id: rows[0].fax_id ? undefined : rows[0].id },
      `このFAX(${rows.length}件)を削除しますか？`
    );
    if (ok) setSenderEdit(null);
  }

  async function deleteItem(item) {
    const ok = await deleteRequest({ id: item.id }, "この1件を削除しますか？");
    if (ok) setEditing(null);
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.heading}>FAX受信一覧</h2>
        <div style={styles.headerButtons}>
          {canManage && (
            <>
              <button style={styles.subButton} onClick={openImport}>
                既存FAXを取り込む
              </button>
              <button style={styles.subButton} onClick={toggleDemo} disabled={busy}>
                {hasDemo ? "サンプルを消す" : "サンプル表示"}
              </button>
              <button style={styles.dangerSub} onClick={deleteAll} disabled={busy}>
                すべて削除
              </button>
            </>
          )}
          <button style={styles.subButton} onClick={() => load()}>
            更新
          </button>
        </div>
      </div>

      <div style={styles.searchBox}>
        <input
          style={styles.searchInput}
          placeholder="🔍 患者名・フリガナ・送信元で検索(過去30日)"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searching && (
          <button style={styles.clearButton} onClick={() => onSearchChange("")}>
            ×
          </button>
        )}
      </div>

      {!searching && today && (
        <div style={styles.chipRow}>
          {last7.map((d) => (
            <button
              key={d}
              style={d === selected ? styles.chipActive : styles.chip}
              onClick={() => selectDate(d)}
            >
              {dayLabel(d, today)}
              {counts[d] > 0 && <span style={styles.chipCount}>{counts[d]}</span>}
            </button>
          ))}
          {selected && !last7.includes(selected) && (
            <span style={styles.chipActive}>{dayLabel(selected, today)}</span>
          )}
          <label style={styles.calendarButton}>
            📅 日付指定
            <input
              type="date"
              style={styles.hiddenDate}
              value={selected || ""}
              onChange={(e) => e.target.value && selectDate(e.target.value)}
            />
          </label>
        </div>
      )}

      {searching && (
        <p style={styles.resultInfo}>
          「{query}」の検索結果 {items.length}件
        </p>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <p>読み込み中...</p>
      ) : faxes.length === 0 ? (
        <p style={styles.muted}>
          {searching ? "見つかりませんでした" : "この日に受信したFAXはありません"}
        </p>
      ) : (
        faxes.map((rows) => {
          const first = rows[0];
          const sender = senderOf(rows);
          const patients = rows.filter((r) => kindOf(r) === "prescription").length;
          return (
            <section key={first.fax_id || first.id} style={styles.faxBlock}>
              <button
                style={styles.faxHeader}
                onClick={() => {
                  setSaveError("");
                  setSenderEdit({ rows, value: sender || "" });
                }}
              >
                <span style={styles.senderLine}>
                  <span style={sender ? styles.sender : styles.senderUnknown}>
                    {sender || "送信元 不明"}
                  </span>
                  <span style={styles.editMark}>✎</span>
                  {first.demo && <span style={styles.badgeDemo}>サンプル</span>}
                  {first.imported && <span style={styles.badgeImport}>取込</span>}
                </span>
                <span style={styles.faxMeta}>
                  {first.imported && first.original_time
                    ? `元の受信 ${formatTime(first.original_time)}`
                    : `${formatTime(first.received_at)} 受信`}{" "}
                  ・ 全{first.source_page_count}頁 → {patients}名分
                </span>
              </button>

              {rows.map((item) => (
                <button key={item.id} style={styles.row} onClick={() => openEdit(item, rows)}>
                  <span style={styles.pages}>{pagesLabel(item.source_pages)}</span>
                  <span style={styles.main}>
                    {kindOf(item) === "prescription" ? (
                      <>
                        <span style={item.extracted?.patient_name ? styles.name : styles.nameUnknown}>
                          {item.extracted?.patient_name || "名前を読み取れず"}
                          {item.extracted?.patient_name && " 様"}
                        </span>
                        {item.extracted?.patient_kana && (
                          <span style={styles.kana}>{item.extracted.patient_kana}</span>
                        )}
                      </>
                    ) : (
                      <span style={styles.other}>
                        {kindOf(item) === "ad" ? "広告・宣伝(合体なし)" : "送付状など"}
                      </span>
                    )}
                  </span>
                  <span style={styles.badges}>
                    {item.needs_review && kindOf(item) === "prescription" && (
                      <span style={styles.badgeOrange}>要確認</span>
                    )}
                    {kindOf(item) === "ad" && <span style={styles.badgeAd}>広告</span>}
                    {!item.imported &&
                      (item.printed_at ? (
                        <span style={styles.badgeGreen}>印刷済</span>
                      ) : autoPrintOf(item) ? (
                        <span style={styles.badgeGray}>未印刷</span>
                      ) : null)}
                  </span>
                </button>
              ))}
              {first.fax_id && rows.reduce((n, r) => n + (r.source_pages?.length || 0), 0) > 1 && (
                <button type="button" style={styles.regroupButton} onClick={() => setRegroupRows(rows)}>
                  ⇅ ページを分ける・まとめる
                </button>
              )}
            </section>
          );
        })
      )}

      {editing && (
        <Modal title="確認・修正" onClose={() => setEditing(null)}>
          <form style={styles.form} onSubmit={saveEdit}>
            <div style={styles.infoBox}>
              <div>送信元: {editing.sender || "不明"}</div>
              <div>
                受信: {formatTime(editing.item.received_at)} / 原本{" "}
                {pagesLabel(editing.item.source_pages)}(全{editing.item.source_page_count}頁)
              </div>
            </div>

            {editing.item.has_pdf ? (
              <FaxPreviewPanel
                key={editing.item.id}
                item={editing.item}
                onItemUpdated={(updated) => {
                  applyUpdated([updated]);
                  setEditing((prev) => (prev ? { ...prev, item: updated } : prev));
                }}
              />
            ) : (
              <p style={styles.note}>このPDFは大きすぎて保存されていないため、プレビューはありません。</p>
            )}

            <div style={styles.pdfButtons}>
              <button type="button" style={styles.pdfButton} onClick={() => openPdf(editing.item)}>
                PDFを開く
              </button>
              {editing.item.has_pdf && <FaxPrintButton ids={[editing.item.id]} />}
            </div>

            <label style={styles.label}>
              区分
              <select
                style={styles.input}
                value={editing.kind}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
              >
                {Object.entries(KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                    {k === "ad" ? "(自動印刷しない・合体しない)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {editing.kind === "prescription" && (
              <>
                <label style={styles.label}>
                  患者名
                  <input
                    style={styles.input}
                    value={editing.patient_name}
                    onChange={(e) => setEditing({ ...editing, patient_name: e.target.value })}
                  />
                </label>
                <label style={styles.label}>
                  フリガナ
                  <input
                    style={styles.input}
                    value={editing.patient_kana}
                    onChange={(e) => setEditing({ ...editing, patient_kana: e.target.value })}
                  />
                </label>
                <label style={styles.label}>
                  生年月日
                  <input
                    style={styles.input}
                    type="date"
                    value={editing.birth_date}
                    onChange={(e) => setEditing({ ...editing, birth_date: e.target.value })}
                  />
                </label>
                <div style={styles.twoCols}>
                  <label style={styles.label}>
                    保険者番号
                    <input
                      style={styles.input}
                      inputMode="numeric"
                      value={editing.insurer_number}
                      onChange={(e) => setEditing({ ...editing, insurer_number: e.target.value })}
                    />
                  </label>
                  <label style={styles.label}>
                    記号・番号
                    <input
                      style={styles.input}
                      value={editing.insured_symbol_number}
                      onChange={(e) => setEditing({ ...editing, insured_symbol_number: e.target.value })}
                    />
                  </label>
                </div>
                <RpEditor value={editing.rps} onChange={(rps) => setEditing({ ...editing, rps })} />
              </>
            )}

            {saveError && <p style={styles.error}>{saveError}</p>}
            <div style={styles.formButtons}>
              <button style={styles.button} type="submit">
                保存
              </button>
              {canManage && (
                <button type="button" style={styles.dangerButton} onClick={() => deleteItem(editing.item)}>
                  この1件を削除
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {senderEdit && (
        <Modal title="送信元を修正" onClose={() => setSenderEdit(null)}>
          <form style={styles.form} onSubmit={saveSender}>
            <label style={styles.label}>
              送信元(医療機関名)
              <input
                style={styles.input}
                value={senderEdit.value}
                placeholder="例: ◯◯クリニック"
                onChange={(e) => setSenderEdit({ ...senderEdit, value: e.target.value })}
              />
            </label>
            <p style={styles.note}>このFAXの全員({senderEdit.rows.length}件)に反映されます</p>
            {saveError && <p style={styles.error}>{saveError}</p>}
            <div style={styles.formButtons}>
              <button style={styles.button} type="submit">
                保存
              </button>
              {canManage && (
                <button type="button" style={styles.dangerButton} onClick={() => deleteFax(senderEdit.rows)}>
                  このFAXを削除
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {regroupRows && (
        <Modal title="ページのまとめ方" onClose={() => setRegroupRows(null)}>
          <FaxRegroup
            rows={regroupRows}
            onCancel={() => setRegroupRows(null)}
            onDone={() => {
              setRegroupRows(null);
              load(true);
            }}
          />
        </Modal>
      )}

      {importOpen && (
        <Modal title="フォルダにある既存FAXを取り込む" onClose={() => setImportOpen(false)}>
          <ImportPanel
            agent={agent}
            count={importCount}
            setCount={setImportCount}
            error={importError}
            onStart={startImport}
            onClose={() => setImportOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function agentOnline(hb) {
  return !!hb && Date.now() - new Date(hb.last_seen).getTime() < 90000;
}

function ImportPanel({ agent, count, setCount, error, onStart, onClose }) {
  const hb = agent?.heartbeat;
  const command = agent?.command;
  const online = agentOnline(hb);
  const active = command && ["pending", "running"].includes(command.status);
  const finished = command && ["done", "failed"].includes(command.status);
  const result = command?.result;

  return (
    <div style={styles.form}>
      <div style={styles.infoBox}>
        <div>
          薬局PCのアプリ:{" "}
          <strong style={{ color: online ? "#047857" : "#dc2626" }}>{online ? "動作中" : "停止中"}</strong>
        </div>
        {hb?.pdf_count != null && <div>FAXフォルダのPDF: {hb.pdf_count}件</div>}
      </div>

      {!active && (
        <>
          <label style={styles.label}>
            新しい順に何件取り込みますか？
            <select style={styles.input} value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}件
                </option>
              ))}
            </select>
          </label>
          <p style={styles.note}>
            取り込んだFAXは印刷されません。1通ごとにAIの利用料がかかります。確認が終わったら「すべて削除」で消せます。
          </p>
          {!online && <p style={styles.error}>アプリが動いていません。薬局のPCでアプリを起動してください。</p>}
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} onClick={onStart} disabled={!online}>
            取り込む
          </button>
        </>
      )}

      {active && (
        <div style={styles.progressBox}>
          <div style={styles.progressTitle}>
            {command.status === "pending" ? "薬局PCに依頼しました(最大15秒ほどで始まります)…" : "取り込み中…"}
          </div>
          {command.progress && <div style={styles.progressText}>{command.progress}</div>}
          <p style={styles.note}>この画面を開いたままお待ちください。閉じても取り込みは続きます。</p>
        </div>
      )}

      {!active && finished && (
        <div style={styles.resultBox}>
          {command.status === "failed" ? (
            <span style={{ color: "#dc2626" }}>失敗しました: {result?.error || "原因不明"}</span>
          ) : (
            <span>
              前回の結果: 新規{result?.uploaded ?? 0}件
              {result?.duplicate ? ` / 取込済み${result.duplicate}件` : ""}
              {result?.too_large ? ` / 大きすぎ${result.too_large}件` : ""}
              {result?.failed ? ` / 失敗${result.failed}件` : ""}
            </span>
          )}
          <button style={styles.linkButton} onClick={onClose}>
            一覧を見る
          </button>
        </div>
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

const chipBase = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.35rem 0.7rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
  whiteSpace: "nowrap",
  cursor: "pointer",
  flexShrink: 0,
};

const styles = {
  container: { padding: "1rem", maxWidth: "720px", minWidth: 0 },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.7rem",
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
  searchBox: { position: "relative", marginBottom: "0.6rem" },
  searchInput: {
    width: "100%",
    padding: "0.6rem 2rem 0.6rem 0.7rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "0.95rem",
  },
  clearButton: {
    position: "absolute",
    right: "0.4rem",
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    background: "none",
    fontSize: "1.1rem",
    color: "#888",
    cursor: "pointer",
  },
  chipRow: { display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "0.4rem" },
  chip: { ...chipBase, border: "1px solid #ccc", background: "#fff", color: "#333" },
  chipActive: { ...chipBase, border: "1px solid #2563eb", background: "#2563eb", color: "#fff" },
  chipCount: { fontSize: "0.7rem", opacity: 0.8 },
  calendarButton: {
    ...chipBase,
    position: "relative",
    border: "1px dashed #2563eb",
    background: "#fff",
    color: "#2563eb",
  },
  hiddenDate: { position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" },
  resultInfo: { fontSize: "0.8rem", color: "#666", margin: "0 0 0.6rem 0" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: 0 },
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
    flexDirection: "column",
    gap: "0.15rem",
    width: "100%",
    padding: "0.65rem 0.9rem",
    background: "#eff6ff",
    border: "none",
    borderBottom: "1px solid #dbeafe",
    textAlign: "left",
    cursor: "pointer",
  },
  senderLine: { display: "flex", alignItems: "center", gap: "0.4rem" },
  sender: { fontWeight: 700, fontSize: "1rem", color: "#1e3a8a" },
  senderUnknown: { fontWeight: 700, fontSize: "1rem", color: "#c2410c" },
  editMark: { fontSize: "0.8rem", color: "#93a3c0" },
  faxMeta: { fontSize: "0.75rem", color: "#555" },
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
  nameUnknown: { fontWeight: 700, fontSize: "0.9rem", color: "#c2410c" },
  kana: { fontSize: "0.72rem", color: "#888" },
  other: { fontSize: "0.85rem", color: "#888" },
  badges: { display: "flex", gap: "0.3rem", flexShrink: 0 },
  badgeGreen: { ...badge, background: "#ecfdf5", color: "#047857" },
  badgeGray: { ...badge, background: "#f3f4f6", color: "#555" },
  badgeOrange: { ...badge, background: "#fff7ed", color: "#c2410c" },
  badgeDemo: { ...badge, background: "#fef3c7", color: "#92400e" },
  badgeImport: { ...badge, background: "#e0e7ff", color: "#3730a3" },
  badgeAd: { ...badge, background: "#fef3c7", color: "#92400e" },
  regroupButton: {
    width: "100%",
    padding: "0.5rem",
    border: "none",
    background: "#fafafa",
    color: "#2563eb",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  pdfButtons: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  twoCols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" },
  dangerSub: {
    padding: "0.4rem 0.8rem",
    borderRadius: "6px",
    border: "1px solid #fca5a5",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.8rem",
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
  formButtons: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  progressBox: { background: "#eff6ff", borderRadius: "8px", padding: "0.9rem", textAlign: "center" },
  progressTitle: { fontWeight: 700, color: "#1e3a8a", fontSize: "0.95rem" },
  progressText: { fontSize: "1.4rem", fontWeight: 700, margin: "0.4rem 0" },
  resultBox: {
    background: "#f9fafb",
    borderRadius: "8px",
    padding: "0.7rem",
    fontSize: "0.85rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  linkButton: {
    alignSelf: "flex-start",
    border: "none",
    background: "none",
    color: "#2563eb",
    fontSize: "0.85rem",
    padding: 0,
    cursor: "pointer",
  },
  form: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  infoBox: { background: "#f9fafb", borderRadius: "8px", padding: "0.6rem", fontSize: "0.8rem", color: "#555", lineHeight: 1.6 },
  pdfButton: {
    padding: "0.55rem",
    borderRadius: "6px",
    border: "1px solid #2563eb",
    background: "#fff",
    color: "#2563eb",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  label: { display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.8rem", color: "#555" },
  input: { padding: "0.6rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" },
  checkRow: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" },
  note: { fontSize: "0.8rem", color: "#888", margin: 0 },
  button: {
    padding: "0.6rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
};
