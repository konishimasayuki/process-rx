import { useEffect, useState } from "react";
import {
  DAY_NAMES,
  disablePush,
  enablePush,
  isIOS,
  isStandalone,
  loadPushState,
  pushAction,
  pushSupported,
} from "./pushClient.js";

const PERMISSION_LABELS = { granted: "許可済み", denied: "許可されていません", prompt: "未設定", default: "未設定" };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜はじまり

export default function MobileSettings({ session, onLogout, onSwitchToAdmin }) {
  const [geo, setGeo] = useState("確認中…");
  const [push, setPush] = useState(null); // { endpoint, subscribed, prefs }
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const ios = isIOS();
  const standalone = isStandalone();
  const supported = pushSupported();

  useEffect(() => {
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((p) => {
          setGeo(p.state);
          p.onchange = () => setGeo(p.state);
        })
        .catch(() => setGeo("prompt"));
    } else {
      setGeo("prompt");
    }
    if (supported) {
      loadPushState()
        .then((s) => {
          setPush(s);
          setPrefs(s.prefs);
        })
        .catch(() => setPush({ subscribed: false }));
    }
  }, [supported]);

  function requestLocation() {
    if (!navigator.geolocation) return setMessage("この端末は位置情報に対応していません");
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeo("granted");
        setMessage("位置情報が使えるようになりました");
      },
      () => {
        setGeo("denied");
        setMessage(
          ios
            ? "位置情報が許可されていません。iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「Safariのサイト」を「使用中のみ」にしてください"
            : "位置情報が許可されていません。Chromeの「︙」→「設定」→「サイトの設定」→「位置情報」で、このサイトを許可してください"
        );
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function turnOn() {
    setBusy(true);
    setMessage("");
    try {
      const endpoint = await enablePush(prefs);
      setPush({ endpoint, subscribed: true, prefs });
      setMessage("通知を有効にしました。「テスト通知」で届くか確かめてください");
    } catch (err) {
      setMessage(
        err.message === "denied"
          ? ios
            ? "通知が許可されていません。iPhoneの「設定」→「通知」→「process-rx」で通知を許可してください"
            : "通知が許可されていません。スマホの「設定」→「アプリ」→「Chrome」→「通知」で許可してください"
          : "通知を有効にできませんでした。電波の良いところでもう一度お試しください"
      );
    }
    setBusy(false);
  }

  async function savePrefs() {
    setBusy(true);
    const r = await pushAction("prefs", push.endpoint, { prefs });
    setBusy(false);
    setMessage(r.status === "ok" ? "通知の曜日・時間を保存しました" : r.error || "保存に失敗しました");
  }

  async function test() {
    setBusy(true);
    const r = await pushAction("test", push.endpoint);
    setBusy(false);
    setMessage(r.status === "ok" ? "テスト通知を送りました(数秒で届きます)" : r.error || "送れませんでした");
  }

  async function turnOff() {
    setBusy(true);
    await disablePush(push.endpoint);
    setPush({ subscribed: false });
    setBusy(false);
    setMessage("この端末の通知をやめました");
  }

  const setDay = (d, patch) => setPrefs({ ...prefs, days: { ...prefs.days, [d]: { ...prefs.days[d], ...patch } } });

  return (
    <div style={styles.container}>
      <section style={styles.card}>
        <div style={styles.label}>ログイン中</div>
        <div style={styles.name}>{session.name}</div>
        <div style={styles.sub}>
          {session.role === "admin" ? "管理者" : "スタッフ"}
          {session.is_driver ? " ・ ドライバー" : " ・ 内勤"}
        </div>
      </section>

      {/* ---- 通知 ---- */}
      <section style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={styles.itemTitle}>通知(FAX受信のお知らせ)</div>
            <div style={styles.sub}>FAXが届くと通知し、アプリのアイコンに件数を表示します</div>
          </div>
          <span style={push?.subscribed ? styles.ok : styles.ng}>{push?.subscribed ? "有効" : "無効"}</span>
        </div>

        {!supported || (ios && !standalone) ? (
          <p style={styles.warn}>
            {ios
              ? "iPhoneは、ホーム画面に追加したアイコンから開いたときだけ通知を使えます(iOS 16.4以上)。下の「ホーム画面に追加」をしてから、アイコンで開き直してください。"
              : "このブラウザは通知に対応していません。Chromeで開いてください。"}
          </p>
        ) : !push ? (
          <p style={styles.sub}>確認中…</p>
        ) : !push.subscribed ? (
          <button style={styles.button} onClick={turnOn} disabled={busy || !prefs}>
            通知を有効にする
          </button>
        ) : null}

        {prefs && (
          <div style={styles.schedule}>
            <div style={styles.scheduleTitle}>通知する曜日と時間</div>
            {DAY_ORDER.map((d) => {
              const day = prefs.days[String(d)];
              return (
                <div key={d} style={styles.dayRow}>
                  <label style={styles.dayCheck}>
                    <input type="checkbox" checked={day.on} onChange={(e) => setDay(String(d), { on: e.target.checked })} />
                    <span style={{ color: d === 0 ? "#dc2626" : d === 6 ? "#2563eb" : "#111" }}>{DAY_NAMES[d]}</span>
                  </label>
                  <input
                    type="time"
                    aria-label={`${DAY_NAMES[d]}曜の開始`}
                    style={styles.time}
                    value={day.from}
                    disabled={!day.on}
                    onChange={(e) => setDay(String(d), { from: e.target.value })}
                  />
                  <span style={styles.tilde}>〜</span>
                  <input
                    type="time"
                    aria-label={`${DAY_NAMES[d]}曜の終了`}
                    style={styles.time}
                    value={day.to}
                    disabled={!day.on}
                    onChange={(e) => setDay(String(d), { to: e.target.value })}
                  />
                </div>
              );
            })}
            <p style={styles.hint}>チェックした曜日の、この時間内に届いたFAXだけ通知します。</p>
            {push?.subscribed && (
              <div style={styles.buttonRow}>
                <button style={styles.button} onClick={savePrefs} disabled={busy}>
                  曜日・時間を保存
                </button>
                <button style={styles.subButton} onClick={test} disabled={busy}>
                  テスト通知
                </button>
              </div>
            )}
            {push?.subscribed && (
              <button style={styles.linkButton} onClick={turnOff} disabled={busy}>
                この端末の通知をやめる
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---- 位置情報 ---- */}
      <section style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={styles.itemTitle}>位置情報</div>
            <div style={styles.sub}>タイムカードの出勤・退勤のときだけ使います</div>
          </div>
          <span style={geo === "granted" ? styles.ok : styles.ng}>{PERMISSION_LABELS[geo] || geo}</span>
        </div>
        <p style={styles.notice}>
          📍 位置情報は、タイムカードで「出勤」「退勤」を押したときに、会社の近く(100m以内)かを確かめるためだけに使います。
          それ以外の画面で使ったり、居場所を記録し続けたりすることはありません。
        </p>
        {geo !== "granted" && (
          <button style={styles.button} onClick={requestLocation}>
            位置情報を許可する
          </button>
        )}
      </section>

      {!standalone && (
        <section style={styles.card}>
          <div style={styles.itemTitle}>ホーム画面に追加</div>
          <div style={styles.sub}>
            {ios
              ? "Safariの下の「共有」ボタン(□に↑) → 「ホーム画面に追加」→「追加」。以後はホーム画面のアイコンから開いてください"
              : "Chromeの右上「︙」→「アプリをインストール」または「ホーム画面に追加」"}
          </div>
        </section>
      )}

      {message && <p style={styles.message}>{message}</p>}

      {session.role === "admin" && (
        <button style={styles.adminButton} onClick={onSwitchToAdmin}>
          管理画面(パソコン表示)に切り替え
        </button>
      )}
      <button style={styles.logout} onClick={onLogout}>
        ログアウト
      </button>
    </div>
  );
}

const styles = {
  container: { padding: "1rem", maxWidth: "520px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.8rem" },
  card: { background: "#fff", borderRadius: "14px", padding: "1rem", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  label: { fontSize: "0.75rem", color: "#888" },
  name: { fontSize: "1.2rem", fontWeight: 700 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" },
  itemTitle: { fontWeight: 700, fontSize: "0.95rem" },
  sub: { fontSize: "0.8rem", color: "#666", marginTop: "0.15rem", lineHeight: 1.5 },
  ok: { fontSize: "0.8rem", color: "#047857", fontWeight: 700, whiteSpace: "nowrap" },
  ng: { fontSize: "0.8rem", color: "#c2410c", fontWeight: 700, whiteSpace: "nowrap" },
  warn: { fontSize: "0.8rem", color: "#c2410c", lineHeight: 1.6, margin: "0.6rem 0 0" },
  notice: { fontSize: "0.78rem", color: "#555", background: "#f8fafc", borderRadius: "8px", padding: "0.6rem", lineHeight: 1.6, margin: "0.6rem 0 0" },
  button: { marginTop: "0.7rem", width: "100%", padding: "0.7rem", borderRadius: "10px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.95rem", cursor: "pointer" },
  subButton: { marginTop: "0.7rem", width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2563eb", background: "#fff", color: "#2563eb", fontSize: "0.95rem", cursor: "pointer" },
  buttonRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" },
  linkButton: { marginTop: "0.6rem", border: "none", background: "none", color: "#888", fontSize: "0.8rem", cursor: "pointer", padding: 0 },
  schedule: { marginTop: "0.9rem", borderTop: "1px solid #f0f0f0", paddingTop: "0.7rem" },
  scheduleTitle: { fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.4rem" },
  dayRow: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0" },
  dayCheck: { display: "flex", alignItems: "center", gap: "0.3rem", width: "3rem", fontWeight: 700 },
  time: { padding: "0.35rem", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.95rem", minWidth: 0, flex: 1 },
  tilde: { color: "#888" },
  hint: { fontSize: "0.72rem", color: "#888", margin: "0.4rem 0 0" },
  message: { fontSize: "0.85rem", color: "#2563eb", margin: 0, lineHeight: 1.6 },
  adminButton: { padding: "0.8rem", borderRadius: "10px", border: "1px solid #2563eb", background: "#fff", color: "#2563eb", fontSize: "0.95rem", cursor: "pointer" },
  logout: { padding: "0.8rem", borderRadius: "10px", border: "1px solid #ccc", background: "#fff", color: "#555", fontSize: "0.95rem", cursor: "pointer" },
};
