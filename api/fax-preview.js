import { Redis } from "@upstash/redis";
import { getSession } from "./_session.js";
import { renderPagePng } from "./_pdf-render.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;

// 合体PDFの1ページ(1枚の用紙)を画像にして返す: ?id=...&page=1&w=1200
// 元のFAXのページ(ページのまとめ方を直す画面用): ?fax_id=...&src_page=3&turn=90&w=360
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }
  if (!(await getSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const { id, fax_id: faxId } = req.query || {};
  const isSource = !!faxId;
  const page = Math.max(1, parseInt(isSource ? req.query?.src_page : req.query?.page, 10) || 1);
  const width = Math.min(1800, Math.max(200, parseInt(req.query?.w, 10) || 1100));
  const turn = isSource ? ((Math.round((Number(req.query?.turn) || 0) / 90) * 90) % 360 + 360) % 360 : 0;
  const key = isSource ? faxId : id;
  if (!key || !ID_RE.test(key)) return res.status(400).json({ error: "idが不正です" });

  const base64 = await redis.get(isSource ? `fax:src:${faxId}` : `fax:pdf:${id}`);
  if (!base64) return res.status(404).json({ error: "PDFが見つかりません" });

  try {
    const { png, pageCount } = await renderPagePng(Buffer.from(String(base64), "base64"), page, width, turn);
    if (!png) return res.status(404).json({ error: "そのページはありません", page_count: pageCount });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Page-Count", String(pageCount));
    res.setHeader("Cache-Control", "private, max-age=600");
    res.status(200).send(png);
  } catch (err) {
    console.error("preview failed:", err);
    res.status(500).json({ error: "プレビューを作れませんでした" });
  }
}
