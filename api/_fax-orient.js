// ページの向きの判定。
// 同じページを 0・90・180・270 度(時計回り)に回した4枚の小さな画像を見せて、
// 「文字が普通に読める1枚」を選ばせる。「文字の上側がどちらを向いているか」を答えさせるより、
// 読める1枚を選ばせるほうが間違えにくい。選んだ1枚の回転角が、そのまま「まっすぐにするために回す角度」。
// 小さく安いモデル(Haiku)で足りる。ページ分けの読み取りと同時に走らせるので、印刷は遅くならない。

import { callClaude } from "./_fax-ai.js";
import { openPdf, renderPage } from "./_pdf-render.js";

const ORIENT_MODEL = process.env.CLAUDE_MODEL_ORIENT || "claude-haiku-5-5";
const LABELS = ["A", "B", "C", "D"];
const ROTATIONS = [0, 90, 180, 270];
const THUMB_WIDTH = 420; // 向きが分かれば十分な小ささ(画像トークンが少ない)
const PAGES_PER_CALL = 6; // 1回の呼び出しに入れるページ数(画像が増えすぎないように)
const MAX_PAGES = 24; // これより多いFAXは、先頭から24ページだけ判定する

const SYSTEM = `あなたは、FAXで届いた書類の向きを判定する担当です。
各ページについて、同じ画像を回転させた A・B・C・D の4枚が渡されます。
印刷された文字が正しい向き(文字が上から下へ・左から右へ、普通に読める向き)になっている1枚を選んでください。
- 処方箋の表題、氏名、薬の欄などの「本文」で判断してください。FAXの端に入る受信日時やFAX番号の行だけで判断しないでください。
- 手書きのメモは、判断に使わなくてかまいません。
- ほぼ白紙・真っ黒など、どれも判断できないページは、readable を false にしてください。
出力はJSONオブジェクトのみ(前置き・説明・コードフェンスは不要):
{"pages":[{"page":1,"best":"A","readable":true}]}`;

// ページを4つの向きで画像にする
async function thumbnails(doc, pageNumber) {
  const images = [];
  for (const rot of ROTATIONS) {
    const { canvas } = await renderPage(doc, pageNumber, THUMB_WIDTH, rot);
    images.push(canvas.toBuffer("image/png").toString("base64"));
  }
  return images;
}

async function askForPages(doc, pageNumbers, timeoutMs) {
  const content = [];
  for (const n of pageNumbers) {
    content.push({ type: "text", text: `ページ${n}:` });
    const images = await thumbnails(doc, n);
    images.forEach((data, i) => {
      content.push({ type: "text", text: LABELS[i] });
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data } });
    });
  }
  content.push({ type: "text", text: `上の${pageNumbers.length}ページについて、読める向きの1枚を選んでください。` });

  const result = await callClaude({
    system: SYSTEM,
    content,
    maxTokens: 3_000 + pageNumbers.length * 100, // 考える分も含めた上限(使った分しか料金はかからない)
    timeoutMs,
    model: ORIENT_MODEL,
  });
  return Array.isArray(result.pages) ? result.pages : [];
}

// 戻り値: { 1: 0, 2: 270, ... }(まっすぐにするために時計回りに回す角度。判定できなかったページは入らない)
// 失敗したら例外を投げず、判定できた分だけ(または空)を返す。呼び出し側が、ページ分けの読み取りの答えで補う
export async function detectOrientations(pdfBuffer, pageCount, timeoutMs = 30_000) {
  const turns = {};
  let doc;
  try {
    doc = await openPdf(pdfBuffer);
    const pages = Array.from({ length: Math.min(pageCount, MAX_PAGES) }, (_, i) => i + 1);
    const chunks = [];
    for (let i = 0; i < pages.length; i += PAGES_PER_CALL) chunks.push(pages.slice(i, i + PAGES_PER_CALL));
    const answers = await Promise.all(
      chunks.map((chunk) => askForPages(doc, chunk, timeoutMs).catch((err) => {
        console.error("orient failed:", chunk, err?.kind, String(err));
        return [];
      }))
    );
    for (const a of answers.flat()) {
      const n = Number(a.page);
      const idx = LABELS.indexOf(String(a.best || "").toUpperCase());
      if (Number.isInteger(n) && n >= 1 && n <= pageCount && idx >= 0 && a.readable !== false) {
        turns[n] = ROTATIONS[idx];
      }
    }
  } catch (err) {
    console.error("orient error:", String(err));
  } finally {
    if (doc) await doc.destroy().catch(() => {});
  }
  return turns;
}
