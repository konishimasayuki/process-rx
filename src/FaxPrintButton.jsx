import { useEffect, useRef, useState } from "react";

// 薬局PCのプリンタで印刷する(アプリに依頼して、終わるまで見守る)
export default function FaxPrintButton({ ids, label = "薬局PCのプリンタで印刷" }) {
  const [state, setState] = useState("idle"); // idle | sending | printing | done | failed
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  async function print() {
    setMessage("");
    setState("sending");
    try {
      const status = await (await fetch("/api/fax-agent")).json();
      const hb = status.heartbeat;
      if (!hb || Date.now() - new Date(hb.last_seen).getTime() > 90000) {
        setState("failed");
        setMessage("薬局PCのアプリが動いていません。PCでアプリを起動してください。");
        return;
      }
      const res = await fetch("/api/fax-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "print", ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("failed");
        setMessage(data.error || "印刷の依頼に失敗しました");
        return;
      }
      const commandId = data.command.id;
      setState("printing");
      setMessage("薬局PCに依頼しました…(15秒ほどで印刷が始まります)");
      let tries = 0;
      clearInterval(timer.current);
      timer.current = setInterval(async () => {
        tries += 1;
        const r = await fetch("/api/fax-agent").catch(() => null);
        const body = r && r.ok ? await r.json() : null;
        const c = body?.command;
        if (c && c.id === commandId && ["done", "failed"].includes(c.status)) {
          clearInterval(timer.current);
          if (c.status === "done") {
            setState("done");
            setMessage(`印刷しました(${c.result?.printed ?? 0}件)`);
          } else {
            setState("failed");
            setMessage("印刷できませんでした。プリンタの電源や用紙を確認してください。");
          }
        } else if (tries > 30) {
          clearInterval(timer.current);
          setState("failed");
          setMessage("時間がかかっています。薬局PCの状態を確認してください。");
        }
      }, 2000);
    } catch {
      setState("failed");
      setMessage("通信エラーが発生しました");
    }
  }

  const busy = state === "sending" || state === "printing";
  return (
    <div style={styles.wrap}>
      <button type="button" style={styles.button} onClick={print} disabled={busy}>
        🖨 {busy ? "印刷中…" : label}
      </button>
      {message && (
        <span style={{ ...styles.message, color: state === "failed" ? "#dc2626" : state === "done" ? "#047857" : "#555" }}>
          {message}
        </span>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: "0.3rem" },
  button: {
    padding: "0.55rem",
    borderRadius: "6px",
    border: "1px solid #047857",
    background: "#fff",
    color: "#047857",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  message: { fontSize: "0.8rem" },
};
