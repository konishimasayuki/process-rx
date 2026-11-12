import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";

const redis = Redis.fromEnv();

// 合体済みPDF(A4横・左右2面)を返す。?id=... 
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }

  // 画面(ログイン中)からの表示か、薬局PCの取込アプリ(合言葉付き)からの取得を許可
  const secret = req.headers["x-fax-secret"];
  const isAgent =
    !!process.env.FAX_SHARED_SECRET && secret === process.env.FAX_SHARED_SECRET;
  if (!isAgent && !(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const { id } = req.query || {};
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    res.status(400).json({ error: "idが不正です" });
    return;
  }

  const base64 = await redis.get(`fax:pdf:${id}`);
  if (!base64) {
    res.status(404).json({ error: "PDFが見つかりません(保存期間切れの可能性があります)" });
    return;
  }

  const buffer = Buffer.from(String(base64), "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="fax-${id}.pdf"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(buffer);
}
