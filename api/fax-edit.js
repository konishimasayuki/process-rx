import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;

async function getItem(id) {
  const raw = await redis.get(`fax:item:${id}`);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

async function saveItem(record) {
  // サンプルは保存期限を保つ
  const opts = record.demo ? { keepTtl: true } : undefined;
  await redis.set(`fax:item:${record.id}`, JSON.stringify(record), opts);
}

// 読み取り結果を人が修正する
//   { id, patient_name, patient_kana, birth_date, is_prescription } … 患者さんごと
//   { ids: [...], sender }                                            … 1通のFAXの送信元(まとめて)
export default async function handler(req, res) {
  if (req.method !== "PUT") {
    res.status(405).json({ error: "PUTのみ対応しています" });
    return;
  }
  if (!(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const body = req.body || {};
  const now = new Date().toISOString();

  if (Array.isArray(body.ids)) {
    const sender = String(body.sender || "").trim();
    if (!sender) return res.status(400).json({ error: "送信元を入力してください" });
    const updated = [];
    for (const id of body.ids.filter((x) => ID_RE.test(String(x)))) {
      const rec = await getItem(id);
      if (!rec) continue;
      rec.sender = sender;
      if (rec.extracted || rec.is_prescription) {
        rec.extracted = { ...(rec.extracted || {}), issuing_institution: sender };
      }
      rec.edited_at = now;
      await saveItem(rec);
      updated.push(rec);
    }
    res.status(200).json({ status: "ok", items: updated });
    return;
  }

  const { id } = body;
  if (!id || !ID_RE.test(id)) return res.status(400).json({ error: "idが不正です" });
  const rec = await getItem(id);
  if (!rec) return res.status(404).json({ error: "見つかりません" });

  const fields = {};
  for (const key of ["patient_name", "patient_kana", "birth_date"]) {
    if (body[key] !== undefined) fields[key] = String(body[key] || "").trim() || null;
  }
  rec.extracted = { ...(rec.extracted || {}), ...fields };
  if (body.is_prescription !== undefined) rec.is_prescription = !!body.is_prescription;
  rec.needs_review = false;
  rec.edited_at = now;
  await saveItem(rec);
  res.status(200).json({ status: "ok", item: rec });
}
