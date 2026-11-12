import { PDFDocument, rgb } from "pdf-lib";

// A4横(pt)
const SHEET_W = 841.89;
const SHEET_H = 595.28;
const MARGIN = 14;
const GAP = 10;

// Claudeが返したグループ分けを検証・補正する。
// - 範囲外/重複したページ番号は捨てる
// - どのグループにも入らなかったページは単独グループとして補う(取りこぼし防止)
// - グループ内のページは昇順、グループは先頭ページ順に並べる
export function normalizeGroups(rawGroups, pageCount) {
  const used = new Set();
  const result = [];

  for (const g of Array.isArray(rawGroups) ? rawGroups : []) {
    const pages = [
      ...new Set(
        (Array.isArray(g?.pages) ? g.pages : [])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount)
      ),
    ]
      .filter((n) => !used.has(n))
      .sort((a, b) => a - b);

    if (pages.length === 0) continue;
    pages.forEach((n) => used.add(n));

    result.push({
      pages,
      is_prescription: g.is_prescription !== false,
      extracted:
        g.extracted && typeof g.extracted === "object" ? g.extracted : null,
      needs_review: false,
    });
  }

  for (let n = 1; n <= pageCount; n++) {
    if (!used.has(n)) {
      result.push({
        pages: [n],
        is_prescription: true,
        extracted: null,
        needs_review: true,
      });
    }
  }

  result.sort((a, b) => a.pages[0] - b.pages[0]);
  return result;
}

// 指定ページ(0始まりのindex配列)を、A4横の用紙に左右2ページずつ並べたPDFにする。
// 3ページ以上なら2ページごとに用紙を増やす。1ページだけなら左側に置く。
export async function buildTwoUpPdf(srcDoc, pageIndexes) {
  const out = await PDFDocument.create();
  const slotW = (SHEET_W - MARGIN * 2 - GAP) / 2;
  const slotH = SHEET_H - MARGIN * 2;

  for (let i = 0; i < pageIndexes.length; i += 2) {
    const slice = pageIndexes.slice(i, i + 2);
    const embedded = await out.embedPdf(srcDoc, slice);
    const sheet = out.addPage([SHEET_W, SHEET_H]);

    embedded.forEach((ep, slot) => {
      const scale = Math.min(slotW / ep.width, slotH / ep.height);
      const w = ep.width * scale;
      const h = ep.height * scale;
      const slotX = MARGIN + slot * (slotW + GAP);
      sheet.drawPage(ep, {
        x: slotX + (slotW - w) / 2,
        y: MARGIN + (slotH - h) / 2,
        width: w,
        height: h,
      });
    });

    // 左右の区切り線
    sheet.drawLine({
      start: { x: SHEET_W / 2, y: MARGIN },
      end: { x: SHEET_W / 2, y: SHEET_H - MARGIN },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  }

  return out.save();
}
