import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";

const redis = Redis.fromEnv();

// 受信したFAX処方箋(患者さんごとに合体済み)の一覧。新しい順、最新200件。
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }

  if (!(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const ids = await redis.lrange("fax:queue", -200, -1);
  if (ids.length === 0) {
    res.status(200).json({ items: [] });
    return;
  }

  const raw = await redis.mget(...ids.map((id) => `fax:item:${id}`));
  const items = raw
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
    .sort((a, b) => {
      const t = new Date(b.received_at) - new Date(a.received_at);
      return t !== 0 ? t : (a.group_index || 0) - (b.group_index || 0);
    });

  res.status(200).json({ items });
}
