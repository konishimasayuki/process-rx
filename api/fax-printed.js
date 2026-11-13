import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// 薬局PCのアプリが印刷を終えたら呼ぶ。一覧に「自動印刷済」「手動印刷済」を出すため。
//   { id, source: "auto" | "manual" }
// source が無い(古いアプリ)ときは、画面からの印刷依頼に入っていれば手動、それ以外は自動とみなす
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
  const record = parse(await redis.get(`fax:item:${id}`));
  if (!record) {
    res.status(404).json({ error: "見つかりません" });
    return;
  }

  let source = req.body?.source;
  if (source !== "auto" && source !== "manual") {
    const command = parse(await redis.get("fax_agent:command"));
    const manual =
      command?.type === "print" && ["pending", "running"].includes(command.status) && (command.ids || []).includes(id);
    source = manual ? "manual" : "auto";
  }

  const now = new Date().toISOString();
  record.printed_at = now;
  if (source === "manual") record.manual_printed_at = now;
  else record.auto_printed_at = now;
  await redis.set(`fax:item:${id}`, JSON.stringify(record), record.demo ? { keepTtl: true } : undefined);
  res.status(200).json({ status: "ok", source });
}
