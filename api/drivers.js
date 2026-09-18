import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

async function getDriverInfo(name) {
  const raw = await redis.get(`driver_info:${name}`);
  if (!raw) return { name, line_id: "" };
  const info = typeof raw === "string" ? JSON.parse(raw) : raw;
  return { name, line_id: info.line_id || "" };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const names = await redis.smembers("drivers:known");
    const drivers = await Promise.all(names.map((n) => getDriverInfo(n)));
    drivers.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    res.status(200).json({ drivers });
    return;
  }

  if (req.method === "POST") {
    const { name, line_id } = req.body || {};
    const trimmed = name && name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "ドライバー名は必須です" });
      return;
    }

    await redis.sadd("drivers:known", trimmed);
    await redis.set(
      `driver_info:${trimmed}`,
      JSON.stringify({ name: trimmed, line_id: line_id || "" })
    );
    res.status(200).json({ status: "ok", name: trimmed, line_id: line_id || "" });
    return;
  }

  if (req.method === "PUT") {
    const { name, line_id } = req.body || {};
    if (!name) {
      res.status(400).json({ error: "nameは必須です" });
      return;
    }

    await redis.set(
      `driver_info:${name}`,
      JSON.stringify({ name, line_id: line_id || "" })
    );
    res.status(200).json({ status: "ok" });
    return;
  }

  if (req.method === "DELETE") {
    const { name } = req.body || {};
    if (!name) {
      res.status(400).json({ error: "nameは必須です" });
      return;
    }

    await redis.srem("drivers:known", name);
    await redis.del(`driver_info:${name}`);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
