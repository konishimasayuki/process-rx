import { useEffect, useState } from "react";
import DestinationsList from "./DestinationsList.jsx";
import DeliveryBoard from "./DeliveryBoard.jsx";
import Settings from "./Settings.jsx";
import PublicBoard from "./PublicBoard.jsx";

function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "ログインに失敗しました");
        setLoading(false);
        return;
      }

      onLoginSuccess();
    } catch {
      setError("通信エラーが発生しました");
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>process-rx</h1>
        <p style={styles.subtitle}>ログイン</p>

        <label style={styles.label}>
          ID
          <input
            style={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>

        <label style={styles.label}>
          パスワード
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}

function HomeTab() {
  return (
    <div style={styles.homeCard}>
      <h1 style={styles.title}>process-rx</h1>
      <p style={styles.subtitle}>ログイン成功。ここにFAX処方箋キューを表示予定。</p>
    </div>
  );
}

// メニュー構成: ジャンル(薬局配達)ごとに項目をまとめる
const MENU_SECTIONS = [
  {
    items: [{ key: "home", label: "ホーム" }],
  },
  {
    label: "薬局配達",
    items: [
      { key: "board", label: "配達ボード" },
      { key: "destinations", label: "配達先一覧" },
    ],
  },
  {
    items: [{ key: "settings", label: "設定" }],
  },
];

function SidebarContent({ tab, onSelect }) {
  return (
    <>
      <div style={styles.sidebarTitle}>process-rx</div>
      <nav>
        {MENU_SECTIONS.map((section, idx) => (
          <div key={idx} style={styles.sidebarSection}>
            {section.label && (
              <div style={styles.sidebarSectionLabel}>{section.label}</div>
            )}
            {section.items.map((item) => (
              <button
                key={item.key}
                style={
                  tab === item.key
                    ? styles.sidebarItemActive
                    : styles.sidebarItem
                }
                onClick={() => onSelect(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

function Dashboard({ onLogout }) {
  const [tab, setTab] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);

  function selectTab(key) {
    setTab(key);
    setMenuOpen(false);
  }

  return (
    <div style={styles.appWrapper}>
      {/* デスクトップ用サイドバー */}
      <aside className="process-rx-sidebar-desktop" style={styles.sidebarDesktop}>
        <SidebarContent tab={tab} onSelect={selectTab} />
        <button style={styles.logoutButton} onClick={onLogout}>
          ログアウト
        </button>
      </aside>

      {/* モバイル用ハンバーガーヘッダー */}
      <header className="process-rx-mobile-header" style={styles.mobileHeader}>
        <button
          style={styles.hamburgerButton}
          onClick={() => setMenuOpen(true)}
          aria-label="メニューを開く"
        >
          ☰
        </button>
        <span style={styles.mobileHeaderTitle}>process-rx</span>
      </header>

      {menuOpen && (
        <div style={styles.mobileOverlay} onClick={() => setMenuOpen(false)}>
          <div
            style={styles.mobileDrawer}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent tab={tab} onSelect={selectTab} />
            <button
              style={styles.logoutButton}
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      )}

      <main className="process-rx-main" style={styles.main}>
        {tab === "home" && <HomeTab />}
        {tab === "board" && <DeliveryBoard />}
        {tab === "destinations" && <DestinationsList />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}

export default function App() {
  const isPublicBoard =
    new URLSearchParams(window.location.search).get("public") === "board";

  const [authenticated, setAuthenticated] = useState(null); // null = 確認中

  useEffect(() => {
    if (isPublicBoard) return;
    fetch("/api/session-check")
      .then((res) => res.json())
      .then((data) => setAuthenticated(!!data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    setAuthenticated(false);
  }

  if (isPublicBoard) {
    return <PublicBoard />;
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; overflow-x: hidden; }
        .process-rx-sidebar-desktop { display: none; }
        .process-rx-mobile-header { display: flex; }
        .process-rx-main { margin-top: 3rem; margin-left: 0; min-width: 0; }
        @media (min-width: 768px) {
          .process-rx-sidebar-desktop { display: flex; }
          .process-rx-mobile-header { display: none; }
          .process-rx-main { margin-top: 0; margin-left: 220px; }
        }
      `}</style>
      {authenticated === null ? (
        <div style={styles.wrapper}>
          <p>読み込み中...</p>
        </div>
      ) : !authenticated ? (
        <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />
      ) : (
        <Dashboard onLogout={handleLogout} />
      )}
    </>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f4f5f7",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    background: "#fff",
    padding: "2.5rem",
    borderRadius: "12px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
    width: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  homeCard: {
    background: "#fff",
    padding: "2rem",
    borderRadius: "12px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
    maxWidth: "480px",
    margin: "1rem",
  },
  title: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 700,
  },
  subtitle: {
    margin: "0 0 0.5rem 0",
    color: "#666",
    fontSize: "0.9rem",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    fontSize: "0.85rem",
    color: "#333",
    gap: "0.25rem",
  },
  input: {
    padding: "0.6rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    fontSize: "1rem",
  },
  button: {
    marginTop: "0.5rem",
    padding: "0.7rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "1rem",
    cursor: "pointer",
  },
  error: {
    color: "#dc2626",
    fontSize: "0.85rem",
    margin: 0,
  },

  // レイアウト
  appWrapper: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    width: "100%",
    minWidth: 0,
  },

  // デスクトップサイドバー(768px未満は非表示)
  sidebarDesktop: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "220px",
    overflowY: "auto",
    background: "#fff",
    borderRight: "1px solid #e5e7eb",
    padding: "1.2rem 0.8rem",
    flexDirection: "column",
    zIndex: 10,
  },

  // モバイルヘッダー
  mobileHeader: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: "3rem",
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0 0.8rem",
    zIndex: 20,
  },
  hamburgerButton: {
    fontSize: "1.3rem",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0.2rem 0.4rem",
  },
  mobileHeaderTitle: { fontWeight: 700, fontSize: "1rem" },

  mobileOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.3)",
    zIndex: 30,
  },
  mobileDrawer: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "240px",
    background: "#fff",
    padding: "1.2rem 0.8rem",
    display: "flex",
    flexDirection: "column",
    boxShadow: "2px 0 12px rgba(0,0,0,0.15)",
  },

  sidebarTitle: {
    fontWeight: 700,
    fontSize: "1.1rem",
    padding: "0 0.5rem 1rem 0.5rem",
  },
  sidebarSection: { marginBottom: "1rem" },
  sidebarSectionLabel: {
    fontSize: "0.7rem",
    color: "#999",
    padding: "0 0.5rem",
    marginBottom: "0.3rem",
    fontWeight: 600,
  },
  sidebarItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.5rem 0.6rem",
    borderRadius: "6px",
    border: "none",
    background: "transparent",
    color: "#333",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  sidebarItemActive: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.5rem 0.6rem",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  logoutButton: {
    marginTop: "auto",
    padding: "0.5rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    fontSize: "0.85rem",
    cursor: "pointer",
  },

  main: {
    flex: 1,
    minWidth: 0,
    paddingTop: "1rem",
  },
};
