import { Redis } from "@upstash/redis";
import { getSession } from "./_session.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// 「読取失敗」の警告を閉じる: 指定したFAXの失敗の印(とバッジ)を消す。AIは呼ばない
//   { ids: ["記録のID", ...] }
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  if (!(await getSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => ID_RE.test(String(x))).slice(0, 200);
  if (ids.length === 0) return res.status(400).json({ error: "対象を指定してください" });

  const now = new Date().toISOString();
  let cleared = 0;
  for (const id of ids) {
    const rec = parse(await redis.get(`fax:item:${id}`));
    if (!rec || !rec.analysis_failed) continue;
    delete rec.analysis_failed;
    delete rec.analysis_error;
    rec.analysis_dismissed_at = now;
    await redis.set(`fax:item:${id}`, JSON.stringify(rec), rec.demo ? { keepTtl: true } : undefined);
    cleared += 1;
  }
  res.status(200).json({ status: "ok", cleared });
}
