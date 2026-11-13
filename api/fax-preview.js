import { Redis } from "@upstash/redis";
import { getSession } from "./_session.js";
import { renderPagePng } from "./_pdf-render.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;

// 合体PDFの1ページ(1枚の用紙)を画像にして返す: ?id=...&page=1&w=1200
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }
  if (!(await getSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const { id } = req.query || {};
  const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
  const width = Math.min(1800, Math.max(400, parseInt(req.query?.w, 10) || 1100));
  if (!id || !ID_RE.test(id)) return res.status(400).json({ error: "idが不正です" });

  const base64 = await redis.get(`fax:pdf:${id}`);
  if (!base64) return res.status(404).json({ error: "PDFが見つかりません" });

  try {
    const { png, pageCount } = await renderPagePng(Buffer.from(String(base64), "base64"), page, width);
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
