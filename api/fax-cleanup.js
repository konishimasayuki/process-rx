import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { RETENTION_DAYS, jstDate, shiftDate } from "./_fax-utils.js";

const redis = Redis.fromEnv();
const CHUNK = 100;
const PARALLEL = 20;
const MAX_PER_RUN = 600; // 1回に消す件数の上限(時間切れを防ぐ。残りは次回)
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// 受信から日数がたったFAX(PDF・読み取り結果・元のPDF)を消す。
//   残すのは「今日と、その前の RETENTION_DAYS 日」。それより前の日に受信したものを消す。
//   ?dry=1 … 消さずに、何が消えるかだけ見る
// 実行できるのは、Vercelの毎日の自動実行(深夜)と、管理者(ブラウザで開く)
export default async function handler(req, res) {
  const bearer = String(req.headers.authorization || "");
  const cronOk = process.env.CRON_SECRET
    ? bearer === `Bearer ${process.env.CRON_SECRET}`
    : String(req.headers["user-agent"] || "").startsWith("vercel-cron/");
  if (!cronOk) {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: "ログインが必要です" });
    if (!isAdmin(session)) return res.status(403).json({ error: "管理者のみ実行できます" });
  }

  const dry = req.query?.dry === "1";
  const today = jstDate();
  const cutoff = shiftDate(today, -RETENTION_DAYS); // この日より前に受信したものを消す

  // 同時に2回動かない
  if (!dry && !(await redis.set("fax:cleanup_lock", "1", { nx: true, ex: 300 }))) {
    return res.status(202).json({ status: "busy" });
  }

  try {
    const ids = await redis.lrange("fax:queue", 0, -1);
    const items = [];
    const missing = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const raw = await redis.mget(...part.map((id) => `fax:item:${id}`));
      raw.forEach((r, k) => {
        const item = parse(r);
        if (item) items.push(item);
        else missing.push(part[k]); // 記録が無いのに一覧に残っているID
      });
    }

    const isOld = (item) => jstDate(new Date(item.received_at)) < cutoff;
    const old = items.filter(isOld).slice(0, MAX_PER_RUN);
    const oldIds = new Set(old.map((i) => i.id));
    const kept = items.filter((i) => !oldIds.has(i.id));

    // 消すFAX(1通)の単位。残るFAXの患者さんが1人でもいれば、そのFAXの元PDFは消さない
    const keptFaxIds = new Set(kept.map((i) => i.fax_id).filter(Boolean));
    const keptNames = new Set(kept.map((i) => i.filename).filter(Boolean));
    const oldFaxIds = [...new Set(old.map((i) => i.fax_id).filter((f) => f && !keptFaxIds.has(f)))];

    const result = {
      status: dry ? "dry-run" : "ok",
      today,
      keep_from: cutoff,
      total_items: items.length,
      deleted_items: old.length,
      deleted_faxes: oldFaxIds.length,
      orphan_ids: missing.length,
      kept_items: kept.length,
      more: items.filter(isOld).length > old.length,
    };
    if (dry) return res.status(200).json(result);

    // --- 患者さんごとの記録とPDF ---
    const keys = [];
    for (const it of old) keys.push(`fax:item:${it.id}`, `fax:pdf:${it.id}`);
    for (const f of oldFaxIds) keys.push(`fax:src:${f}`, `fax:hash_items:${f}`);
    // 古い日付の一覧(今日からさかのぼって、残す日より前の分をまとめて)
    for (let k = 1; k <= 60; k++) keys.push(`fax:date:${shiftDate(cutoff, -k)}`);
    for (let i = 0; i < keys.length; i += CHUNK) await redis.del(...keys.slice(i, i + CHUNK));

    // --- 一覧・取込済みの記録から外す ---
    const removeIds = [...oldIds, ...missing];
    for (let i = 0; i < removeIds.length; i += PARALLEL) {
      await Promise.all(removeIds.slice(i, i + PARALLEL).map((id) => redis.lrem("fax:queue", 0, id)));
    }
    if (oldFaxIds.length) await redis.srem("fax:processed_hashes", ...oldFaxIds);
    const goneNames = [...new Set(old.map((i) => i.filename).filter((n) => n && !keptNames.has(n)))];
    if (goneNames.length) await redis.srem("fax:processed_filenames", ...goneNames);
    const demoIds = old.filter((i) => i.demo).map((i) => i.id);
    if (demoIds.length) await redis.srem("fax:demo_ids", ...demoIds);

    return res.status(200).json(result);
  } finally {
    if (!dry) await redis.del("fax:cleanup_lock");
  }
}
