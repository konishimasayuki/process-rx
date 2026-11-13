import { Redis } from "@upstash/redis";
import { PDFDocument } from "pdf-lib";
import { getSession } from "./_session.js";
import { buildItemPdf, countSheets, normalizeTurn } from "./_pdf-utils.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;
const TTL = 60 * 60 * 24 * 60;

export async function rebuildItemPdf(record) {
  const src = record.fax_id ? await redis.get(`fax:src:${record.fax_id}`) : null;
  if (!src) return false;
  const srcDoc = await PDFDocument.load(Buffer.from(String(src), "base64"), { ignoreEncryption: true });
  const bytes = await buildItemPdf(srcDoc, {
    kind: record.kind || (record.is_prescription ? "prescription" : "cover"),
    source_pages: record.source_pages,
    crops: record.crops || {},
    turns: record.turns || {},
    layout: record.layout || { fit: "auto", zoom: 1 },
  });
  await redis.set(`fax:pdf:${record.id}`, Buffer.from(bytes).toString("base64"), { ex: TTL });
  record.sheet_count = await countSheets(bytes); // 向きを変えると横長になり、枚数が変わることがある
  return true;
}

// 印刷の大きさ(拡大率・自動フィット/全体)や向きを人が変えて、PDFを作り直す
//   { id, fit: "auto"|"full", zoom: 0.5〜2, turns: { "1": 90 } }
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  if (!(await getSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const { id, fit, zoom, turns } = req.body || {};
  if (!id || !ID_RE.test(id)) return res.status(400).json({ error: "idが不正です" });

  const raw = await redis.get(`fax:item:${id}`);
  if (!raw) return res.status(404).json({ error: "見つかりません" });
  const record = typeof raw === "string" ? JSON.parse(raw) : raw;

  const current = record.layout || { fit: "auto", zoom: 1 };
  const z = Math.round(Math.min(2, Math.max(0.5, Number(zoom ?? current.zoom) || 1)) * 100) / 100;
  record.layout = { fit: (fit ?? current.fit) === "full" ? "full" : "auto", zoom: z };
  // ページごとの向き(時計回りの角度)。{"1": 90} のように元のページ番号で指定
  if (turns && typeof turns === "object") {
    const pages = new Set((record.source_pages || []).map(String));
    const next = { ...(record.turns || {}) };
    for (const [page, deg] of Object.entries(turns)) {
      if (!pages.has(String(page))) continue;
      const t = normalizeTurn(deg);
      if (t) next[String(page)] = t;
      else delete next[String(page)];
    }
    record.turns = next;
  }
  record.pdf_updated_at = new Date().toISOString();

  let rebuilt = false;
  try {
    rebuilt = await rebuildItemPdf(record);
  } catch (err) {
    console.error("rebuild failed:", err);
  }
  if (!rebuilt) {
    return res.status(410).json({ error: "元のPDFが残っていないため、大きさを変えられません(保存期間切れ・古い取込)" });
  }

  await redis.set(`fax:item:${id}`, JSON.stringify(record), record.demo ? { keepTtl: true } : undefined);
  res.status(200).json({ status: "ok", item: record });
}
