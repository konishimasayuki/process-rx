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
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.process_rx_session;

  if (!token) {
    res.status(401).json({ authenticated: false });
    return;
  }

  const username = await redis.get(`session:${token}`);
  if (!username) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.status(200).json({ authenticated: true, username });
}
