import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// 薬局PCのアプリが印刷を終えたら呼ぶ。一覧に「印刷済」を出すため。
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  const secret = req.headers["x-fax-secret"];
  if (!process.env.FAX_SHARED_SECRET || secret !== process.env.FAX_SHARED_SECRET) {
    res.status(401).json({ error: "認証エラー" });
    return;
  }
  const { id } = req.body || {};
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    res.status(400).json({ error: "idが不正です" });
    return;
  }
  const raw = await redis.get(`fax:item:${id}`);
  if (!raw) {
    res.status(404).json({ error: "見つかりません" });
    return;
  }
  const record = typeof raw === "string" ? JSON.parse(raw) : raw;
  record.printed_at = new Date().toISOString();
  await redis.set(`fax:item:${id}`, JSON.stringify(record));
  res.status(200).json({ status: "ok" });
}
