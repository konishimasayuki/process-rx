import { Redis } from "@upstash/redis";
import { PDFDocument } from "pdf-lib";
import { getSession } from "./_session.js";
import { extractGroup, fillFromBasic } from "./_fax-ai.js";
import { loadFaxItems, saveSummary } from "./_fax-store.js";

const redis = Redis.fromEnv();
const ID_RE = /^[A-Za-z0-9_-]+$/;
const LOCK_SECONDS = 120;

// 印刷を急ぐために後回しにした「処方内容の詳しい読み取り」を行う。
//   { fax_id } … そのFAXで、まだ読み取っていない処方箋だけを読み取る(何度呼んでも二重には読まない)
// 印刷アプリ(合言葉)が印刷の後に呼ぶ。画面からも、残っているときに呼ぶ
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  const isAgent = !!process.env.FAX_SHARED_SECRET && req.headers["x-fax-secret"] === process.env.FAX_SHARED_SECRET;
  if (!isAgent && !(await getSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const faxId = req.body?.fax_id;
  if (!faxId || !ID_RE.test(String(faxId))) return res.status(400).json({ error: "fax_idが不正です" });

  // 同じFAXを同時に2回読まないよう、鍵をかける
  const locked = await redis.set(`fax:extract_lock:${faxId}`, "1", { nx: true, ex: LOCK_SECONDS });
  if (!locked) {
    res.status(202).json({ status: "busy" });
    return;
  }

  try {
    const items = await loadFaxItems(redis, faxId);
    const pending = items.filter((it) => it.kind === "prescription" && it.extract_status === "pending");
    if (pending.length === 0) {
      res.status(200).json({ status: "nothing", updated: 0 });
      return;
    }

    const src = await redis.get(`fax:src:${faxId}`);
    if (!src) {
      res.status(410).json({ error: "元のPDFが残っていません" });
      return;
    }
    const srcDoc = await PDFDocument.load(Buffer.from(String(src), "base64"), { ignoreEncryption: true });

    const now = new Date().toISOString();
    await Promise.all(
      pending.map(async (it) => {
        const basic = it.extracted || {};
        try {
          const detail = await extractGroup(srcDoc, { pages: it.source_pages, turns: it.turns || {} }, 50_000);
          const filled = fillFromBasic(detail, { infos: [{ ...basic, institution: basic.issuing_institution }] });
          if (it.edited_at) {
            // 読み取り中に人が直した項目は、そのまま残す
            for (const key of ["patient_name", "patient_kana", "birth_date", "insurer_number", "insured_symbol_number"]) {
              if (basic[key]) filled[key] = basic[key];
            }
            if (basic.rps_edited) {
              filled.rps = basic.rps;
              filled.rps_edited = true;
            }
          }
          it.extracted = filled;
          it.extract_status = "done";
        } catch (err) {
          console.error("deferred extract failed:", it.id, err?.kind, String(err));
          it.extract_status = "failed";
        }
        it.extracted_at = now;
        it.needs_review = !it.extracted || !it.extracted.patient_name || it.extract_status === "failed";
        // 他の操作で消えていたら書き戻さない
        if (await redis.exists(`fax:item:${it.id}`)) {
          await redis.set(`fax:item:${it.id}`, JSON.stringify(it), it.demo ? { keepTtl: true } : undefined);
        }
      })
    );
    await saveSummary(redis, faxId, items);
    res.status(200).json({
      status: "ok",
      updated: pending.length,
      failed: pending.filter((it) => it.extract_status === "failed").length,
    });
  } finally {
    await redis.del(`fax:extract_lock:${faxId}`);
  }
}
