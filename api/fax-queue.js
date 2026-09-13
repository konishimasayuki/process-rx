import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const sharedSecret = req.headers["x-fax-secret"];
  if (!process.env.FAX_SHARED_SECRET || sharedSecret !== process.env.FAX_SHARED_SECRET) {
    res.status(401).json({ error: "認証エラー" });
    return;
  }

  if (req.method === "GET") {
    const ids = await redis.lrange("fax:queue", 0, -1);
    if (ids.length === 0) {
      res.status(200).json({ items: [] });
      return;
    }

    const keys = ids.map((id) => `fax:item:${id}`);
    const rawItems = await redis.mget(...keys);
    const items = rawItems
      .filter(Boolean)
      .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

    res.status(200).json({ items });
    return;
  }

  if (req.method === "POST") {
    // 確認済み/入力済みへのステータス更新用
    const { id, status } = req.body || {};
    if (!id || !status) {
      res.status(400).json({ error: "id と status は必須です" });
      return;
    }

    const raw = await redis.get(`fax:item:${id}`);
    if (!raw) {
      res.status(404).json({ error: "該当データが見つかりません" });
      return;
    }

    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    record.status = status;
    record.updated_at = new Date().toISOString();
    await redis.set(`fax:item:${id}`, JSON.stringify(record));

    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POSTのみ対応しています" });
}
