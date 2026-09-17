import { useEffect, useState } from "react";
import DestinationsList from "./DestinationsList.jsx";
import DeliveryBoard from "./DeliveryBoard.jsx";

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
    <div style={styles.card}>
      <h1 style={styles.title}>process-rx</h1>
      <p style={styles.subtitle}>ログイン成功。ここにFAX処方箋キューを表示予定。</p>
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [tab, setTab] = useState("home");

  return (
    <div style={styles.appWrapper}>
      <header style={styles.header}>
        <span style={styles.headerTitle}>process-rx</span>
        <button style={styles.logoutButton} onClick={onLogout}>
          ログアウト
        </button>
      </header>

      <nav style={styles.nav}>
        <button
          style={tab === "home" ? styles.navButtonActive : styles.navButton}
          onClick={() => setTab("home")}
        >
          ホーム
        </button>
        <button
          style={tab === "board" ? styles.navButtonActive : styles.navButton}
          onClick={() => setTab("board")}
        >
          配達ボード
        </button>
        <button
          style={tab === "destinations" ? styles.navButtonActive : styles.navButton}
          onClick={() => setTab("destinations")}
        >
          配達先一覧
        </button>
      </nav>

      <main style={styles.main}>
        {tab === "home" && <HomeTab />}
        {tab === "board" && <DeliveryBoard />}
        {tab === "destinations" && <DestinationsList />}
      </main>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = 確認中

  useEffect(() => {
    fetch("/api/session-check")
      .then((res) => res.json())
      .then((data) => setAuthenticated(!!data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    setAuthenticated(false);
  }

  if (authenticated === null) {
    return (
      <div style={styles.wrapper}>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={handleLogout} />;
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
  appWrapper: {
    minHeight: "100vh",
    background: "#f4f5f7",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.8rem 1rem",
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
  },
  headerTitle: { fontWeight: 700, fontSize: "1.1rem" },
  logoutButton: {
    padding: "0.4rem 0.8rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  nav: {
    display: "flex",
    gap: "0.5rem",
    padding: "0.6rem 1rem",
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
    overflowX: "auto",
  },
  navButton: {
    padding: "0.4rem 0.8rem",
    borderRadius: "999px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.85rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  navButtonActive: {
    padding: "0.4rem 0.8rem",
    borderRadius: "999px",
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.85rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  main: {
    paddingTop: "1rem",
  },
};
