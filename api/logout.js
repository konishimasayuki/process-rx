import { parseCookies } from "./_auth-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies.process_rx_session;

  if (raw && raw.startsWith("redis:")) {
    const token = raw.slice("redis:".length);
    try {
      const { Redis } = await import("@upstash/redis");
      const redis = Redis.fromEnv();
      await redis.del(`session:${token}`);
    } catch (err) {
      // Upstashが不通でもCookie削除は続行する
      console.error("redis session delete failed (upstash unreachable?):", err);
    }
  }
  // standaloneトークンはサーバー側に状態を持たないため、Cookie削除のみで失効する

  res.setHeader(
    "Set-Cookie",
    "process_rx_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure"
  );
  res.status(200).json({ status: "ok" });
}
