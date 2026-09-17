import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method === "GET") {
    const drivers = await redis.smembers("drivers:known");
    res
      .status(200)
      .json({ drivers: drivers.sort((a, b) => a.localeCompare(b, "ja")) });
    return;
  }

  if (req.method === "POST") {
    const { name } = req.body || {};
    const trimmed = name && name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "ドライバー名は必須です" });
      return;
    }

    await redis.sadd("drivers:known", trimmed);
    res.status(200).json({ status: "ok", name: trimmed });
    return;
  }

  if (req.method === "DELETE") {
    const { name } = req.body || {};
    if (!name) {
      res.status(400).json({ error: "nameは必須です" });
      return;
    }

    await redis.srem("drivers:known", name);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/DELETEのみ対応しています" });
}
