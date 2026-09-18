import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }

  const raw = await redis.lrange("line:friend_history", 0, 49);
  const history = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  res.status(200).json({ history });
}
