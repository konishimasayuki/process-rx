import { useEffect, useState } from "react";

const PERMISSION_LABELS = { granted: "許可済み", denied: "拒否されています", prompt: "未設定", default: "未設定" };

export default function MobileSettings({ session, onLogout, onSwitchToAdmin }) {
  const [geo, setGeo] = useState("確認中…");
  const [notif, setNotif] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [message, setMessage] = useState("");

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
  }, []);

  function requestLocation() {
    if (!navigator.geolocation) return setMessage("この端末は位置情報に対応していません");
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeo("granted");
        setMessage("位置情報が使えるようになりました");
      },
      () => {
        setGeo("denied");
        setMessage("位置情報が許可されていません。スマホの設定 → ブラウザ(Safari/Chrome) → 位置情報 から許可してください");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function requestNotification() {
    if (typeof Notification === "undefined") {
      setMessage("この端末では通知に対応していません。iPhoneはホーム画面に追加したアプリから開くと使えます");
      return;
    }
    const result = await Notification.requestPermission();
    setNotif(result);
    if (result === "granted") {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification("process-rx", { body: "通知が届くようになりました", icon: "/icons/icon-192.png" });
      setMessage("通知を許可しました");
    }
  }

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;

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

      <section style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={styles.itemTitle}>位置情報</div>
            <div style={styles.sub}>出勤・退勤のときに会社の近くか確認します</div>
          </div>
          <span style={geo === "granted" ? styles.ok : styles.ng}>{PERMISSION_LABELS[geo] || geo}</span>
        </div>
        {geo !== "granted" && (
          <button style={styles.button} onClick={requestLocation}>
            位置情報を許可する
          </button>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={styles.itemTitle}>通知</div>
            <div style={styles.sub}>FAX受信などのお知らせ(順次追加予定)</div>
          </div>
          <span style={notif === "granted" ? styles.ok : styles.ng}>
            {notif === "unsupported" ? "非対応" : PERMISSION_LABELS[notif] || notif}
          </span>
        </div>
        {notif !== "granted" && notif !== "unsupported" && (
          <button style={styles.button} onClick={requestNotification}>
            通知を許可する
          </button>
        )}
      </section>

      {!standalone && (
        <section style={styles.card}>
          <div style={styles.itemTitle}>ホーム画面に追加</div>
          <div style={styles.sub}>
            {isIOS
              ? "Safariの下の「共有」ボタン → 「ホーム画面に追加」で、アプリのように使えます"
              : "ブラウザのメニュー(︙) → 「アプリをインストール」または「ホーム画面に追加」"}
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
  button: { marginTop: "0.7rem", width: "100%", padding: "0.7rem", borderRadius: "10px", border: "none", background: "#2563eb", color: "#fff", fontSize: "0.95rem", cursor: "pointer" },
  message: { fontSize: "0.85rem", color: "#2563eb", margin: 0 },
  adminButton: { padding: "0.8rem", borderRadius: "10px", border: "1px solid #2563eb", background: "#fff", color: "#2563eb", fontSize: "0.95rem", cursor: "pointer" },
  logout: { padding: "0.8rem", borderRadius: "10px", border: "1px solid #ccc", background: "#fff", color: "#555", fontSize: "0.95rem", cursor: "pointer" },
};
