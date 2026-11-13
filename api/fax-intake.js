import { Redis } from "@upstash/redis";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { buildItemPdf, countSheets, normalizeGroups } from "./_pdf-utils.js";
import { analyzePages } from "./_pdf-render.js";
import { SAFETY_TTL_SECONDS as PDF_TTL_SECONDS, jstDate, pickSender, rxDetailsEnabled } from "./_fax-utils.js";
import {
  basicExtracted,
  classifyPages,
  describeAiError,
  extractGroup,
  fillFromBasic,
  groupPages,
  isRetryable,
} from "./_fax-ai.js";
import { recordAiStatus } from "./_ai-status.js";
import { saveSummary, summaryOf } from "./_fax-store.js";
import { detectOrientations } from "./_fax-orient.js";
import { notifyFax } from "./_push.js";

const redis = Redis.fromEnv();

const MAX_STORED_PDF_BASE64 = 9_000_000; // Upstashのリクエスト上限(10MB)に収める
const TIME_BUDGET_MS = 52_000; // サーバーの制限(60秒)に収める
const RETRIES_BEFORE_FALLBACK = 3; // 読み取り失敗はこの回数までは再送してもらう
const AI_RETRY_DELAY_MS = Number(process.env.AI_RETRY_DELAY_MS ?? 1500); // 一時的な失敗のとき、待ってからやり直す間隔

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ページ分けの読み取り。混み合い・利用制限・時間切れのような「待てば直る」失敗は、待って自動でやり直す。
// 残高不足・キーの間違いのような「待っても直らない」失敗は、すぐ失敗として返す
async function classifyWithRetry(pdfBase64, pageCount, remaining) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await classifyPages(pdfBase64, pageCount, Math.max(5_000, Math.min(35_000, remaining() - 8_000)));
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || remaining() < 25_000) break;
      await sleep(AI_RETRY_DELAY_MS * (i + 1));
    }
  }
  return { error: lastErr };
}

// 各ページの「処方箋の本体の範囲」(余白を除いて大きく印刷するため)。失敗しても取込は続ける
async function detectCrops(pdfBuffer, pageCount) {
  const crops = {};
  if (pageCount > 20) return crops;
  try {
    (await analyzePages(pdfBuffer)).forEach((box, i) => {
      if (box) {
        crops[String(i + 1)] = {
          x0: +box.x0.toFixed(4),
          y0: +box.y0.toFixed(4),
          x1: +box.x1.toFixed(4),
          y1: +box.y1.toFixed(4),
        };
      }
    });
  } catch (err) {
    console.error("page analyze failed:", err);
  }
  return crops;
}

export default async function handler(req, res) {
  const started = Date.now();
  const remaining = () => TIME_BUDGET_MS - (Date.now() - started);

  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const sharedSecret = req.headers["x-fax-secret"];
  if (!process.env.FAX_SHARED_SECRET || sharedSecret !== process.env.FAX_SHARED_SECRET) {
    res.status(401).json({ error: "認証エラー" });
    return;
  }

  const { filename, pdf_base64, imported, original_time } = req.body || {};
  const attempt = Number(req.body?.attempt) || 1;
  // true: 処方内容の詳しい読み取りは後回しにして、印刷用のPDFを早く返す(印刷アプリが後で /api/fax-extract を呼ぶ)
  const deferExtract = req.body?.defer_extract === true;
  const timings = {};
  if (!filename || !pdf_base64) {
    res.status(400).json({ error: "filename と pdf_base64 は必須です" });
    return;
  }

  const pdfBuffer = Buffer.from(pdf_base64, "base64");
  const contentHash = crypto.createHash("sha1").update(pdfBuffer).digest("hex").slice(0, 12);

  // 同じ中身のPDFは二重に処理しない
  if (await redis.sismember("fax:processed_hashes", contentHash)) {
    // 取込済み。印刷アプリが途中で止まった場合に備えて、前回の結果を返す
    const prev = await redis.get(`fax:hash_items:${contentHash}`);
    const items = prev ? (typeof prev === "string" ? JSON.parse(prev) : prev) : [];
    res.status(200).json({ status: "duplicate", filename, fax_id: contentHash, items, ids: items.map((x) => x.id) });
    return;
  }

  let srcDoc;
  try {
    srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  } catch (err) {
    res.status(400).json({ error: "PDFを読み込めません", detail: String(err) });
    return;
  }
  const pageCount = srcDoc.getPageCount();

  // 1) ページごとの区分と本人情報(氏名・フリガナ・生年月日・保険者番号など)を読む。余白の検出も同時に進める
  // 向きの判定(4枚に回した画像から読める1枚を選ばせる)も同時に進める。ページ分けが失敗しても向きは直せる
  const [crops, classified, orientTurns] = await Promise.all([
    detectCrops(pdfBuffer, pageCount),
    classifyWithRetry(pdf_base64, pageCount, remaining),
    detectOrientations(pdfBuffer, pageCount, Math.min(30_000, remaining())),
  ]);
  timings.classify_ms = Date.now() - started;

  let rawGroups = null;
  let rawSender = null;
  const turns = {}; // ページごとの追加の回転(横倒しの処方箋をまっすぐに)
  let analysisError = null; // ページ分けの読み取りに失敗したときの原因
  if (classified.error) {
    const err = classified.error;
    console.error("fax classify failed:", err?.kind, err?.status, String(err));
    await recordAiStatus(redis, err);
    if (attempt < RETRIES_BEFORE_FALLBACK && isRetryable(err)) {
      // 一時的な失敗かもしれないので、アプリに再送してもらう(残高不足などは待っても直らないので、すぐ取り込む)
      res.status(500).json({ error: "FAXの読み取りに失敗しました(再試行します)", detail: String(err), attempt });
      return;
    }
    // 読めないときは、全ページを「要確認」の単独グループで取り込む(取りこぼし防止)。
    // 向きは判定できていれば、まっすぐにして印刷する。失敗の原因は記録して、画面に出す
    analysisError = { ...describeAiError(err), at: new Date().toISOString() };
    for (const [n, t] of Object.entries(orientTurns)) if (t) turns[n] = t;
  } else {
    await recordAiStatus(redis, null);
    rawSender = classified.sender;

    // 2) 同じ人のページをまとめ、患者さんごとに処方内容まで詳しく読む(同時に進める)
    const grouped = groupPages(classified.pages, pageCount, orientTurns);
    await Promise.all(
      grouped.map(async (g) => {
        if (g.kind !== "prescription") return;
        // 処方内容を読まない設定(初期): ページ分けで読めた名前などだけで済ませる(AIの呼び出しが減る)
        if (!rxDetailsEnabled()) {
          g.extracted = basicExtracted(g);
          return;
        }
        if (deferExtract) {
          // 印刷を急ぐ: 1段階目で読めた名前などだけ入れておき、詳しい読み取りは後で
          g.extracted = basicExtracted(g);
          g.extractPending = true;
          return;
        }
        try {
          const detail = await extractGroup(srcDoc, g, remaining() - 3000);
          g.extracted = fillFromBasic(detail, g);
        } catch (err) {
          console.error("fax extract failed:", g.pages, err.kind, String(err));
          g.extracted = basicExtracted(g); // 本人情報だけでも残す(要確認)
          g.needs_review = true;
        }
      })
    );
    timings.extract_ms = Date.now() - started - timings.classify_ms;
    rawGroups = grouped.map((g) => ({
      pages: g.pages,
      kind: g.kind,
      extracted: g.extracted || null,
      needs_review: !!g.needs_review,
      extract_pending: !!g.extractPending,
    }));
    grouped.forEach((g) => Object.assign(turns, g.turns || {}));
  }

  const groups = normalizeGroups(rawGroups, pageCount).map((g) => {
    const raw = rawGroups && rawGroups.find((r) => r.pages[0] === g.pages[0]);
    return {
      ...g,
      needs_review: g.needs_review || raw?.needs_review || false,
      extract_pending: !!raw?.extract_pending,
    };
  });
  const sender = pickSender(rawSender, groups);
  const dateKey = `fax:date:${jstDate()}`;

  // 3) グループごとに、並べたPDFを作って保存
  const receivedAt = new Date().toISOString();
  const createdIds = [];
  const savedRecords = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const id = `${contentHash}-${i + 1}`;
    const itemKey = `fax:item:${id}`;

    const layout = { fit: "auto", zoom: 1 };
    const groupCrops = Object.fromEntries(g.pages.filter((n) => crops[String(n)]).map((n) => [String(n), crops[String(n)]]));
    const groupTurns = Object.fromEntries(g.pages.filter((n) => turns[String(n)]).map((n) => [String(n), turns[String(n)]]));
    const mergedBytes = await buildItemPdf(srcDoc, {
      kind: g.kind,
      source_pages: g.pages,
      crops: groupCrops,
      turns: groupTurns,
      layout,
    });
    const mergedBase64 = Buffer.from(mergedBytes).toString("base64");
    const hasPdf = mergedBase64.length <= MAX_STORED_PDF_BASE64;
    if (hasPdf) {
      await redis.set(`fax:pdf:${id}`, mergedBase64, { ex: PDF_TTL_SECONDS });
    }

    const record = {
      id,
      fax_id: contentHash,
      // 既存フォルダから後で取り込んだFAX(元の受信時刻つき・印刷しない)
      imported: imported === true ? true : undefined,
      original_time:
        imported === true && original_time && !Number.isNaN(Date.parse(original_time))
          ? new Date(original_time).toISOString()
          : undefined,
      sender,
      filename,
      received_at: receivedAt,
      status: "pending",
      group_index: i + 1,
      group_count: groups.length,
      source_pages: g.pages,
      source_page_count: pageCount,
      sheet_count: await countSheets(mergedBytes),
      kind: g.kind,
      is_prescription: g.is_prescription,
      auto_print: g.kind !== "ad", // 広告以外は自動で印刷する
      // 詳しい読み取りが後回しのときは、終わるまで「要確認」にしない
      needs_review:
        g.kind === "prescription" &&
        !g.extract_pending &&
        (g.needs_review || !g.extracted || !g.extracted.patient_name),
      analysis_failed: analysisError ? true : undefined,
      analysis_error: analysisError || undefined,
      extract_status: g.kind === "prescription" ? (g.extract_pending ? "pending" : "done") : undefined,
      crops: groupCrops,
      turns: groupTurns,
      layout,
      has_pdf: hasPdf,
      extracted: g.extracted,
    };

    const existed = await redis.exists(itemKey);
    await redis.set(itemKey, JSON.stringify(record));
    if (!existed) {
      await redis.rpush("fax:queue", id);
      await redis.rpush(dateKey, id);
    }
    createdIds.push(id);
    savedRecords.push(record);
  }

  // 元のPDFは、拡大率の調整などで作り直すために保存しておく
  if (pdf_base64.length <= MAX_STORED_PDF_BASE64) {
    await redis.set(`fax:src:${contentHash}`, pdf_base64, { ex: PDF_TTL_SECONDS });
  }

  await saveSummary(redis, contentHash, savedRecords);
  await redis.sadd("fax:processed_hashes", contentHash);
  await redis.sadd("fax:processed_filenames", filename);

  // スマホに通知(待ちすぎないよう最大4秒。失敗しても取込は成功扱い)
  if (imported !== true) {
    const patients = savedRecords.filter((r) => r.kind === "prescription").length;
    await Promise.race([
      notifyFax(redis, { faxId: contentHash, sender, patients, others: savedRecords.length - patients }).catch((err) =>
        console.error("notify failed:", err)
      ),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  }

  timings.total_ms = Date.now() - started;
  res.status(200).json({
    status: "ok",
    fax_id: contentHash,
    pages: pageCount,
    groups: groups.map((g) => g.pages),
    ids: createdIds,
    items: summaryOf(savedRecords),
    extract_pending: savedRecords.some((r) => r.extract_status === "pending"),
    timings,
  });
}
