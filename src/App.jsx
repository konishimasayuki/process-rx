import { useEffect, useState } from "react";

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

function Dashboard({ onLogout }) {
  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>process-rx</h1>
        <p style={styles.subtitle}>ログイン成功。ここにFAX処方箋キューを表示予定。</p>
        <button style={styles.button} onClick={onLogout}>
          ログアウト
        </button>
      </div>
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
};
