import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const { date, driver } = req.body || {};
  if (!date) {
    res.status(400).json({ error: "dateは必須です" });
    return;
  }

  const ids = await redis.smembers(`board:date:${date}`);
  if (ids.length === 0) {
    res.status(200).json({ status: "ok" });
    return;
  }

  const keys = ids.map((id) => `board_entry:${id}`);
  const raw = await redis.mget(...keys);
  const entries = raw
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  // 手動並び順をクリアすると、表示時に出発地点からの最近傍法で自動並び替えされる
  for (const entry of entries) {
    if ((entry.driver || "") === (driver || "") && entry.manual_order != null) {
      entry.manual_order = null;
      await redis.set(`board_entry:${entry.id}`, JSON.stringify(entry));
    }
  }

  res.status(200).json({ status: "ok" });
}
