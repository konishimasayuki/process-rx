import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...rest] = pair.trim().split("=");
    cookies[key] = rest.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.process_rx_session;

  if (token) {
    await redis.del(`session:${token}`);
  }

  res.setHeader(
    "Set-Cookie",
    "process_rx_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure"
  );
  res.status(200).json({ status: "ok" });
}
