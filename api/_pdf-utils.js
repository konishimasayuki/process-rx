import {
  PDFDocument,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";

// A4横(pt)
const SHEET_W = 841.89;
const SHEET_H = 595.28;
const MARGIN = 14;
const GAP = 10;
const MAX_SCALE = 1.6; // 拡大しすぎない(FAXの画像は元が粗いため)

export const KINDS = ["prescription", "cover", "ad"];

// Claudeが返したグループ分けを検証・補正する。
// - 範囲外/重複したページ番号は捨てる
// - どのグループにも入らなかったページは単独グループとして補う(取りこぼし防止)
// - グループ内のページは昇順、グループは先頭ページ順に並べる
// - 区分(kind): prescription=処方箋 / cover=送付状など / ad=宣伝・広告
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

    const kind = KINDS.includes(g.kind) ? g.kind : g.is_prescription === false ? "cover" : "prescription";
    result.push({
      pages,
      kind,
      is_prescription: kind === "prescription",
      extracted:
        kind === "prescription" && g.extracted && typeof g.extracted === "object" ? g.extracted : null,
      needs_review: false,
    });
  }

  for (let n = 1; n <= pageCount; n++) {
    if (!used.has(n)) {
      result.push({
        pages: [n],
        kind: "prescription",
        is_prescription: true,
        extracted: null,
        needs_review: true,
      });
    }
  }

  result.sort((a, b) => a.pages[0] - b.pages[0]);
  return result;
}

// 割合(左上原点)の範囲を、PDFの座標(左下原点)の範囲にする
function cropToBox(page, crop) {
  const mb = page.getMediaBox();
  return {
    left: mb.x + crop.x0 * mb.width,
    right: mb.x + crop.x1 * mb.width,
    top: mb.y + (1 - crop.y0) * mb.height,
    bottom: mb.y + (1 - crop.y1) * mb.height,
  };
}

// 指定ページ(0始まりのindex配列)を、A4横の用紙に左右2ページずつ並べたPDFにする。
// 3ページ以上なら2ページごとに用紙を増やす。1ページだけなら左側に置く。
//   options.crops : ページごとの内容の範囲(割合)。あれば、その範囲だけを大きく並べる
//   options.fit   : "auto"=範囲に合わせて拡大 / "full"=ページ全体
//   options.zoom  : 拡大率の倍率(0.5〜2)。人が調整する
export async function buildTwoUpPdf(srcDoc, pageIndexes, options = {}) {
  const { crops = [], fit = "auto", zoom = 1 } = options;
  const out = await PDFDocument.create();
  const slotW = (SHEET_W - MARGIN * 2 - GAP) / 2;
  const slotH = SHEET_H - MARGIN * 2;
  const zoomFactor = Math.min(2, Math.max(0.5, Number(zoom) || 1));

  for (let i = 0; i < pageIndexes.length; i += 2) {
    const slice = pageIndexes.slice(i, i + 2);
    const embedded = [];
    for (let k = 0; k < slice.length; k++) {
      const srcPage = srcDoc.getPage(slice[k]);
      const crop = fit === "auto" ? crops[i + k] : null;
      embedded.push(await out.embedPage(srcPage, crop ? cropToBox(srcPage, crop) : undefined));
    }

    // 左右で同じ倍率にそろえる(大きいほうに合わせる)
    const fitScale = Math.min(...embedded.map((ep) => Math.min(slotW / ep.width, slotH / ep.height)));
    const scale = Math.min(fitScale, MAX_SCALE) * zoomFactor;

    const sheet = out.addPage([SHEET_W, SHEET_H]);
    embedded.forEach((ep, slot) => {
      const w = ep.width * scale;
      const h = ep.height * scale;
      const slotX = MARGIN + slot * (slotW + GAP);
      // 拡大して枠からはみ出す分は、隣の面にかからないよう切り取る
      sheet.pushOperators(pushGraphicsState(), rectangle(slotX, MARGIN, slotW, slotH), clip(), endPath());
      sheet.drawPage(ep, {
        x: slotX + (slotW - w) / 2,
        y: MARGIN + (slotH - h) / 2,
        width: w,
        height: h,
      });
      sheet.pushOperators(popGraphicsState());
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

// 合体せず、元のページをそのまま並べたPDF(広告など)
export async function buildPlainPdf(srcDoc, pageIndexes) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(srcDoc, pageIndexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

// 区分に応じて、保存するPDFを作る
export async function buildItemPdf(srcDoc, { kind, source_pages, crops, layout }) {
  const indexes = source_pages.map((n) => n - 1);
  if (kind === "ad") return buildPlainPdf(srcDoc, indexes);
  const cropList = kind === "prescription" ? source_pages.map((n) => crops?.[String(n)] || null) : [];
  return buildTwoUpPdf(srcDoc, indexes, {
    crops: cropList,
    fit: layout?.fit === "full" ? "full" : "auto",
    zoom: layout?.zoom || 1,
  });
}

export function sheetCount(kind, pageTotal) {
  return kind === "ad" ? pageTotal : Math.ceil(pageTotal / 2);
}

// 自動印刷するか(広告以外。古い記録は処方箋だけ)
export function shouldAutoPrint(item) {
  if (item.auto_print !== undefined) return !!item.auto_print;
  return !!item.is_prescription;
}
