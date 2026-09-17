import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }

  const drivers = await redis.smembers("drivers:known");
  res.status(200).json({ drivers: drivers.sort((a, b) => a.localeCompare(b, "ja")) });
}
