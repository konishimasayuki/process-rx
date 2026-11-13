import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { jstDate } from "./_fax-utils.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;
const CHUNK = 100;

async function delKeys(keys) {
  const list = [...keys];
  for (let i = 0; i < list.length; i += CHUNK) {
    await redis.del(...list.slice(i, i + CHUNK));
  }
}

async function loadAllItems() {
  const ids = await redis.lrange("fax:queue", 0, -1);
  const items = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const raw = await redis.mget(...ids.slice(i, i + CHUNK).map((id) => `fax:item:${id}`));
    raw.filter(Boolean).forEach((r) => items.push(typeof r === "string" ? JSON.parse(r) : r));
  }
  return { ids, items };
}

// FAXの削除(管理者のみ)
//   { all: true }   … すべて削除(取込済みの記録も消すので、同じPDFをもう一度取り込める)
//   { fax_id }      … 1通のFAX(全員分)を削除
//   { id }          … 患者さん1件だけ削除
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });
  if (!isAdmin(session)) return res.status(403).json({ error: "削除は管理者のみできます" });

  const { all, fax_id, id } = req.body || {};

  if (all === true) {
    const { ids, items } = await loadAllItems();
    const keys = new Set(["fax:queue", "fax:processed_hashes", "fax:processed_filenames", "fax:demo_ids"]);
    ids.forEach((x) => {
      keys.add(`fax:item:${x}`);
      keys.add(`fax:pdf:${x}`);
    });
    items.forEach((it) => {
      keys.add(`fax:date:${jstDate(new Date(it.received_at))}`);
      if (it.fax_id) keys.add(`fax:hash_items:${it.fax_id}`);
    });
    await delKeys(keys);
    res.status(200).json({ status: "ok", deleted: ids.length });
    return;
  }

  if ((fax_id && ID_RE.test(String(fax_id))) || (id && ID_RE.test(String(id)))) {
    const { items } = await loadAllItems();
    const targets = fax_id ? items.filter((it) => it.fax_id === fax_id) : items.filter((it) => it.id === id);
    if (targets.length === 0) return res.status(404).json({ error: "見つかりません" });

    const targetIds = new Set(targets.map((t) => t.id));
    for (const it of targets) {
      await redis.del(`fax:item:${it.id}`, `fax:pdf:${it.id}`);
      await redis.lrem("fax:queue", 0, it.id);
      await redis.lrem(`fax:date:${jstDate(new Date(it.received_at))}`, 0, it.id);
      await redis.srem("fax:demo_ids", it.id);
    }
    // そのFAXの患者さんが1人も残らなくなったら、同じPDFをもう一度取り込めるよう取込済みの記録も消す
    for (const faxId of new Set(targets.map((t) => t.fax_id).filter(Boolean))) {
      const remaining = items.some((it) => it.fax_id === faxId && !targetIds.has(it.id));
      if (!remaining) {
        await redis.del(`fax:hash_items:${faxId}`);
        await redis.srem("fax:processed_hashes", faxId);
      }
    }
    res.status(200).json({ status: "ok", deleted: targets.length });
    return;
  }

  res.status(400).json({ error: "削除する対象を指定してください" });
}
