import { parseCookies, verifyStandaloneToken } from "./_auth-utils.js";

// ログイン中のセッションCookieが有効かを返す(固定アカウントはUpstash不要で検証)
export async function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies.process_rx_session;
  if (!raw || !raw.includes(":")) return false;

  const [kind, token] = raw.split(/:(.+)/);

  if (kind === "standalone") {
    return !!verifyStandaloneToken(token);
  }

  if (kind === "redis") {
    try {
      const { Redis } = await import("@upstash/redis");
      const redis = Redis.fromEnv();
      return !!(await redis.get(`session:${token}`));
    } catch {
      return false;
    }
  }

  return false;
}
