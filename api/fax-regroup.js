import { Redis } from "@upstash/redis";
import { PDFDocument } from "pdf-lib";
import { getSession } from "./_session.js";
import { buildItemPdf, countSheets } from "./_pdf-utils.js";
import { extractGroup, fillFromBasic } from "./_fax-ai.js";
import { detectOrientations } from "./_fax-orient.js";
import { recordAiStatus } from "./_ai-status.js";
import { SAFETY_TTL_SECONDS as TTL, jstDate } from "./_fax-utils.js";
import { loadFaxItems, parse, saveSummary } from "./_fax-store.js";

const redis = Redis.fromEnv();
const MAX_STORED_PDF_BASE64 = 9_000_000;
const ID_RE = /^[A-Za-z0-9_-]+$/;

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[String(k)]).map((k) => [String(k), obj[String(k)]]));

// ページのまとめ方を人が直す(ドッキング・切り離し)
//   { fax_id, groups: [[1,2],[3],[4,5]] }  ← 連続したページのまとまりを、ページ順に
// 変わったまとまりだけPDFを作り直し、AIが読み直す。変わらないまとまりはそのまま
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });

  // reread: true … まとめ方は変えず、AIで読み直す(名前・送信元・処方内容)。only に記録のIDを渡すと、その1件だけ
  const { fax_id: faxId, groups, reread, only } = req.body || {};
  if (!faxId || !ID_RE.test(String(faxId))) return res.status(400).json({ error: "fax_idが不正です" });

  const items = await loadFaxItems(redis, faxId);
  if (items.length === 0) return res.status(404).json({ error: "このFAXが見つかりません" });

  // --- 入力の確認: 全ページをちょうど1回ずつ、ページ順の連続したまとまりで ---
  const allPages = [...new Set(items.flatMap((it) => it.source_pages))].sort((a, b) => a - b);
  if (!Array.isArray(groups) || groups.length === 0 || !groups.every((g) => Array.isArray(g) && g.length)) {
    return res.status(400).json({ error: "ページのまとまりを指定してください" });
  }
  const flat = groups.flat().map(Number);
  const contiguous = (() => {
    let pos = 0;
    for (const g of groups) {
      for (const n of g) {
        if (Number(n) !== allPages[pos]) return false;
        pos++;
      }
    }
    return pos === allPages.length;
  })();
  if (flat.length !== allPages.length || !contiguous) {
    return res.status(400).json({ error: "すべてのページを、ページ順に1回ずつ指定してください" });
  }

  const srcBase64 = await redis.get(`fax:src:${faxId}`);
  if (!srcBase64) {
    return res.status(410).json({ error: "元のPDFが残っていないため、まとめ方を変えられません(保存期間切れ・古い取込)" });
  }
  const srcDoc = await PDFDocument.load(Buffer.from(String(srcBase64), "base64"), { ignoreEncryption: true });

  // --- 新しいまとまりごとに、前の記録をそのまま使うか、作り直すかを決める ---
  const byKey = new Map(items.map((it) => [it.source_pages.join(","), it]));
  const itemOfPage = new Map();
  items.forEach((it) => it.source_pages.forEach((n) => itemOfPage.set(n, it)));
  const allCrops = Object.assign({}, ...items.map((it) => it.crops || {}));
  const allTurns = Object.assign({}, ...items.map((it) => it.turns || {}));

  const plan = groups.map((g) => {
    const pages = g.map(Number);
    const same = byKey.get(pages.join(","));
    // 読み直しのときは、まとめ方が同じでも(対象のものは)作り直す
    if (same && !(reread === true && (!only || only === same.id) && (same.kind || "prescription") === "prescription")) {
      return { pages, item: same, changed: false };
    }
    if (same) return { pages, base: same, kind: "prescription", inherit: true, changed: true, reread: true };
    const covering = [...new Set(pages.map((n) => itemOfPage.get(n)))];
    const kinds = covering.map((it) => it.kind || (it.is_prescription ? "prescription" : "cover"));
    const kind = kinds.includes("prescription") ? "prescription" : kinds.every((k) => k === "ad") ? "ad" : "cover";
    const base = itemOfPage.get(pages[0]);
    // まとまりが前の記録の先頭ページから始まるなら同じ人とみなし、読み直しに失敗したときは前の内容を使う
    const inherit = base.source_pages[0] === pages[0];
    return { pages, base, kind, inherit, changed: true };
  });

  const used = new Set(plan.filter((p) => !p.changed).map((p) => p.item.id));
  for (const p of plan.filter((x) => x.changed)) {
    p.id = used.has(p.base.id) ? `${faxId}-r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` : p.base.id;
    used.add(p.id);
  }

  // --- AIの読み取りに失敗していたFAXは、向きも判定し直す(人が回した向きは、そのまま残す) ---
  const failedBefore = items.some((it) => it.analysis_failed);
  if (reread === true && failedBefore) {
    const detected = await detectOrientations(Buffer.from(String(srcBase64), "base64"), srcDoc.getPageCount(), 30_000);
    for (const [n, t] of Object.entries(detected)) {
      if (t && !allTurns[n]) allTurns[n] = t;
    }
  }

  // --- 変わったまとまり: 処方箋はAIが読み直す(同時に進める) ---
  await Promise.all(
    plan
      .filter((p) => p.changed && p.kind === "prescription")
      .map(async (p) => {
        const fallbackInfo = p.inherit && p.base.extracted ? [{ ...p.base.extracted, institution: p.base.extracted.issuing_institution }] : [];
        try {
          const detail = await extractGroup(srcDoc, { pages: p.pages, turns: pick(allTurns, p.pages) }, 40_000);
          p.extracted = fillFromBasic(detail, { infos: fallbackInfo });
          await recordAiStatus(redis, null);
        } catch (err) {
          console.error("regroup extract failed:", p.pages, err?.kind, String(err));
          await recordAiStatus(redis, err);
          p.extracted = p.inherit ? p.base.extracted || null : null;
          p.needsReview = true;
        }
      })
  );

  // --- 保存 ---
  const now = new Date().toISOString();
  const records = [];
  for (const p of plan) {
    if (!p.changed) {
      records.push({ ...p.item });
      continue;
    }
    const crops = pick(allCrops, p.pages);
    const turns = pick(allTurns, p.pages);
    const layout = p.base.layout || { fit: "auto", zoom: 1 };
    const bytes = await buildItemPdf(srcDoc, { kind: p.kind, source_pages: p.pages, crops, turns, layout });
    const pdfBase64 = Buffer.from(bytes).toString("base64");
    const hasPdf = pdfBase64.length <= MAX_STORED_PDF_BASE64;
    if (hasPdf) await redis.set(`fax:pdf:${p.id}`, pdfBase64, { ex: TTL });
    const extracted = p.kind === "prescription" ? p.extracted || null : null;
    records.push({
      id: p.id,
      fax_id: faxId,
      imported: p.base.imported,
      original_time: p.base.original_time,
      demo: p.base.demo,
      sender: p.base.sender,
      filename: p.base.filename,
      received_at: p.base.received_at,
      status: "pending",
      source_pages: p.pages,
      source_page_count: p.base.source_page_count,
      sheet_count: await countSheets(bytes),
      kind: p.kind,
      is_prescription: p.kind === "prescription",
      auto_print: p.kind !== "ad",
      needs_review: p.kind === "prescription" && (!!p.needsReview || !extracted || !extracted.patient_name),
      crops,
      turns,
      layout,
      has_pdf: hasPdf,
      extracted,
      // まとめ直したものは未印刷に戻す(必要なら画面から印刷)。読み直しだけのときは、印刷の記録をそのまま残す
      printed_at: p.reread ? p.base.printed_at ?? null : null,
      auto_printed_at: p.reread ? p.base.auto_printed_at : undefined,
      manual_printed_at: p.reread ? p.base.manual_printed_at : undefined,
      extract_status: p.kind === "prescription" ? "done" : undefined,
      analysis_failed: p.reread && p.needsReview ? p.base.analysis_failed : undefined,
      analysis_error: p.reread && p.needsReview ? p.base.analysis_error : undefined,
      regrouped_at: now,
      regrouped_by: session.name,
      pdf_updated_at: now,
    });
  }

  // 送信元が不明のFAXは、読み取れた医療機関名から補う
  const knownSender =
    records.find((r) => r.sender)?.sender || records.map((r) => r.extracted?.issuing_institution).find(Boolean) || null;
  if (knownSender) records.forEach((r) => (r.sender = r.sender || knownSender));

  records.forEach((r, i) => {
    r.group_index = i + 1;
    r.group_count = records.length;
  });

  // 使わなくなった記録を消し、新しい記録を一覧に入れる
  const keepIds = new Set(records.map((r) => r.id));
  for (const old of items) {
    if (keepIds.has(old.id)) continue;
    await redis.del(`fax:item:${old.id}`, `fax:pdf:${old.id}`);
    await redis.lrem("fax:queue", 0, old.id);
    await redis.lrem(`fax:date:${jstDate(new Date(old.received_at))}`, 0, old.id);
  }
  const oldIds = new Set(items.map((it) => it.id));
  for (const r of records) {
    await redis.set(`fax:item:${r.id}`, JSON.stringify(r), r.demo ? { ex: TTL } : undefined);
    if (!oldIds.has(r.id)) {
      await redis.rpush("fax:queue", r.id);
      await redis.rpush(`fax:date:${jstDate(new Date(r.received_at))}`, r.id);
    }
  }
  await saveSummary(redis, faxId, records);

  res.status(200).json({
    status: "ok",
    items: records,
    changed: plan.filter((p) => p.changed).map((p) => p.pages),
  });
}
