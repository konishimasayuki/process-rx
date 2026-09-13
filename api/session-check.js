import { parseCookies, verifyStandaloneToken } from "./_auth-utils.js";

async function checkRedisSession(token) {
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const username = await redis.get(`session:${token}`);
    return username || null;
  } catch (err) {
    console.error("redis session check failed (upstash unreachable?):", err);
    return null;
  }
}

export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies.process_rx_session;

  if (!raw || !raw.includes(":")) {
    res.status(401).json({ authenticated: false });
    return;
  }

  const [kind, token] = raw.split(/:(.+)/); // 最初の":"だけで分割(トークン内に"."は含むが":"は含まない)

  if (kind === "standalone") {
    const result = verifyStandaloneToken(token);
    if (!result) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.status(200).json({ authenticated: true, username: result.username });
    return;
  }

  if (kind === "redis") {
    const username = await checkRedisSession(token);
    if (!username) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.status(200).json({ authenticated: true, username });
    return;
  }

  res.status(401).json({ authenticated: false });
}
