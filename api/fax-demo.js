import { Redis } from "@upstash/redis";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession, isAdmin } from "./_session.js";
import { buildTwoUpPdf } from "./_pdf-utils.js";
import { jstDate } from "./_fax-utils.js";

const redis = Redis.fromEnv();
const DEMO_TTL = 60 * 60 * 24 * 7;

// 一覧の見え方を確認するためのサンプル(本物のFAXではない)
const SAMPLE_FAXES = [
  {
    key: "a",
    filename: "SAMPLE_FAX_001.pdf",
    sender: "福岡東クリニック",
    minutesAgo: 25,
    pageCount: 5,
    groups: [
      { pages: [1, 2], name: "山田 花子", kana: "ヤマダ ハナコ", inst: "福岡東クリニック", printed: true },
      { pages: [3, 4], name: "田中 太郎", kana: "タナカ タロウ", inst: "福岡東クリニック", printed: true },
      { pages: [5], name: "佐藤 一郎", kana: "サトウ イチロウ", inst: "福岡東クリニック", printed: true },
    ],
  },
  {
    key: "b",
    filename: "SAMPLE_FAX_002.pdf",
    sender: "香椎こどもクリニック",
    minutesAgo: 6,
    pageCount: 4,
    groups: [
      { pages: [1], cover: true },
      { pages: [2, 3], name: "鈴木 美咲", kana: "スズキ ミサキ", inst: "香椎こどもクリニック", printed: true },
      { pages: [4], unreadable: true },
    ],
  },
];

async function buildSamplePdf(fax) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= fax.pageCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 30, y: 30, width: 535, height: 782, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
    page.drawText("SAMPLE", { x: 60, y: 760, size: 40, font, color: rgb(0.8, 0.1, 0.1) });
    page.drawText(`${fax.filename}  page ${i}/${fax.pageCount}`, { x: 60, y: 720, size: 16, font });
    for (let y = 660; y > 120; y -= 40) {
      page.drawLine({ start: { x: 60, y }, end: { x: 535, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    }
  }
  return PDFDocument.load(await doc.save());
}

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }
  if (!isAdmin(session)) {
    res.status(403).json({ error: "サンプルの表示・削除は管理者のみできます" });
    return;
  }

  if (req.method === "DELETE") {
    const ids = await redis.smembers("fax:demo_ids");
    for (const id of ids) {
      const raw = await redis.get(`fax:item:${id}`);
      if (raw) {
        const rec = typeof raw === "string" ? JSON.parse(raw) : raw;
        await redis.lrem(`fax:date:${jstDate(new Date(rec.received_at))}`, 0, id);
      }
      await redis.del(`fax:item:${id}`);
      await redis.del(`fax:pdf:${id}`);
      await redis.lrem("fax:queue", 0, id);
    }
    await redis.del("fax:demo_ids");
    res.status(200).json({ status: "ok", removed: ids.length });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST/DELETEのみ対応しています" });
    return;
  }

  const created = [];
  for (const fax of SAMPLE_FAXES) {
    const srcDoc = await buildSamplePdf(fax);
    const receivedAt = new Date(Date.now() - fax.minutesAgo * 60000).toISOString();

    for (let i = 0; i < fax.groups.length; i++) {
      const g = fax.groups[i];
      const id = `demo-${fax.key}-${i + 1}`;
      const bytes = await buildTwoUpPdf(srcDoc, g.pages.map((n) => n - 1));
      await redis.set(`fax:pdf:${id}`, Buffer.from(bytes).toString("base64"), { ex: DEMO_TTL });

      const record = {
        id,
        fax_id: `demo-${fax.key}`,
        sender: fax.sender,
        demo: true,
        filename: fax.filename,
        received_at: receivedAt,
        status: "pending",
        group_index: i + 1,
        group_count: fax.groups.length,
        source_pages: g.pages,
        source_page_count: fax.pageCount,
        sheet_count: Math.ceil(g.pages.length / 2),
        is_prescription: !g.cover,
        needs_review: !!g.unreadable,
        has_pdf: true,
        printed_at: g.printed ? receivedAt : null,
        extracted:
          g.cover || g.unreadable
            ? null
            : { patient_name: g.name, patient_kana: g.kana, issuing_institution: g.inst, confidence: "high" },
      };
      const existed = await redis.exists(`fax:item:${id}`);
      await redis.set(`fax:item:${id}`, JSON.stringify(record), { ex: DEMO_TTL });
      if (!existed) await redis.rpush("fax:queue", id);
      const dateKey = `fax:date:${jstDate(new Date(receivedAt))}`;
      await redis.lrem(dateKey, 0, id);
      await redis.rpush(dateKey, id);
      await redis.sadd("fax:demo_ids", id);
      created.push(id);
    }
  }
  res.status(200).json({ status: "ok", created: created.length });
}
