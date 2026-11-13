import { useState } from "react";
import PublicBoard from "./PublicBoard.jsx";
import FaxQueue from "./FaxQueue.jsx";
import MobileHome from "./MobileHome.jsx";
import TimecardTab from "./TimecardTab.jsx";
import MobileSettings from "./MobileSettings.jsx";

const Icon = ({ d }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TABS = [
  { key: "delivery", label: "配達", icon: <Icon d={<><rect x="1" y="6" width="14" height="10" rx="1" /><path d="M15 9h4l3 3v4h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>} /> },
  { key: "fax", label: "処方箋", icon: <Icon d={<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>} /> },
  { key: "home", label: "ホーム", icon: <Icon d={<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>} /> },
  { key: "timecard", label: "タイムカード", icon: <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} /> },
  { key: "settings", label: "設定", icon: <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>} /> },
];

// 従業員ログイン時のスマホ画面(下にメニュー)
export default function MobileApp({ session, onLogout, onSwitchToAdmin }) {
  // 通知をタップして開いたとき(/?tab=fax)は、そのタブから
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return ["delivery", "fax", "home", "timecard", "settings"].includes(t) ? t : "home";
  });

  return (
    <div style={styles.app}>
      <main style={styles.main}>
        {tab === "delivery" &&
          (session.is_driver ? (
            <PublicBoard embedded fabBottom="calc(78px + env(safe-area-inset-bottom))" />
          ) : (
            <div style={styles.locked}>
              <div style={styles.lockedIcon}>🚚</div>
              <div style={styles.lockedTitle}>配達はドライバー専用です</div>
              <p style={styles.lockedText}>
                ドライバー登録されると見られるようになります。
                <br />
                管理者に「従業員一覧」でドライバーのチェックを入れてもらってください。
              </p>
            </div>
          ))}
        {tab === "fax" && <FaxQueue canManage={session.role === "admin"} />}
        {tab === "home" && <MobileHome session={session} onNavigate={setTab} />}
        {tab === "timecard" && <TimecardTab />}
        {tab === "settings" && (
          <MobileSettings session={session} onLogout={onLogout} onSwitchToAdmin={onSwitchToAdmin} />
        )}
      </main>

      <nav style={styles.nav}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const isHome = t.key === "home";
          return (
            <button key={t.key} style={styles.navButton} onClick={() => setTab(t.key)}>
              <span
                style={
                  isHome
                    ? { ...styles.homeBubble, background: active ? "#2563eb" : "#93a3c0" }
                    : { color: active ? "#2563eb" : "#8a94a6" }
                }
              >
                {t.icon}
              </span>
              <span style={{ ...styles.navLabel, color: active ? "#2563eb" : "#8a94a6", fontWeight: active ? 700 : 400 }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: "system-ui, -apple-system, sans-serif",
    paddingTop: "env(safe-area-inset-top)",
  },
  main: { paddingBottom: "calc(76px + env(safe-area-inset-bottom))" },
  nav: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    background: "#fff",
    borderTop: "1px solid #e5e7eb",
    paddingBottom: "env(safe-area-inset-bottom)",
    zIndex: 100,
  },
  navButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.15rem",
    padding: "0.45rem 0 0.4rem",
    background: "none",
    border: "none",
    cursor: "pointer",
    minHeight: "60px",
  },
  homeBubble: {
    width: "46px",
    height: "46px",
    borderRadius: "50%",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "-22px",
    boxShadow: "0 4px 12px rgba(37,99,235,0.35)",
    border: "3px solid #fff",
  },
  navLabel: { fontSize: "0.66rem" },
  locked: { maxWidth: "420px", margin: "3rem auto 0", padding: "1.5rem", textAlign: "center" },
  lockedIcon: { fontSize: "2.6rem", marginBottom: "0.5rem" },
  lockedTitle: { fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" },
  lockedText: { fontSize: "0.88rem", color: "#666", lineHeight: 1.8 },
};
