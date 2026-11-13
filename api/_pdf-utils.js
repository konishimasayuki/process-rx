import {
  PDFDocument,
  clip,
  degrees,
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

// ページの「表示するときの回転」(0/90/180/270度・時計回り)。
// FAXのPDFは、画像を横向きで保存して表示時に回す指定が付いていることがある
function rotationOf(page) {
  const a = Math.round((page.getRotation().angle || 0) / 90) * 90;
  return ((a % 360) + 360) % 360;
}

// 表示上の割合(左上原点)の範囲を、回転前のPDF座標(左下原点)の範囲にする
function cropToBox(page, crop, rot) {
  const cb = page.getCropBox();
  const { x0, y0, x1, y1 } = crop;
  let u0, u1, v0, v1; // 回転前の横(左→右)・縦(下→上)の割合
  if (rot === 90) {
    [u0, u1, v0, v1] = [y0, y1, x0, x1];
  } else if (rot === 180) {
    [u0, u1, v0, v1] = [1 - x1, 1 - x0, y0, y1];
  } else if (rot === 270) {
    [u0, u1, v0, v1] = [1 - y1, 1 - y0, 1 - x1, 1 - x0];
  } else {
    [u0, u1, v0, v1] = [x0, x1, 1 - y1, 1 - y0];
  }
  return {
    left: cb.x + u0 * cb.width,
    right: cb.x + u1 * cb.width,
    bottom: cb.y + v0 * cb.height,
    top: cb.y + v1 * cb.height,
  };
}

function fullBox(page) {
  const cb = page.getCropBox();
  return { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height };
}

export const normalizeTurn = (t) => ((Math.round((Number(t) || 0) / 90) * 90) % 360 + 360) % 360;

// ページを取り込み、表示上の(回転後の)幅・高さも返す。
//   crop : PDFの表示上(ページの回転指定を適用した状態)での内容の範囲
//   turn : さらに時計回りに回す角度(画像の中で処方箋が横倒しのとき。AIが判断・人が修正)
async function embedUpright(out, srcPage, crop, turn = 0) {
  const pageRot = rotationOf(srcPage);
  const ep = await out.embedPage(srcPage, crop ? cropToBox(srcPage, crop, pageRot) : fullBox(srcPage));
  const rot = (pageRot + normalizeTurn(turn)) % 360;
  const swap = rot === 90 || rot === 270;
  return { ep, rot, w: swap ? ep.height : ep.width, h: swap ? ep.width : ep.height };
}

// 表示上の左下(X,Y)に、文字が正しい向きになるよう回して描く
function drawUpright(sheet, item, X, Y, scale) {
  const w = item.ep.width * scale;
  const h = item.ep.height * scale;
  let x = X;
  let y = Y;
  if (item.rot === 90) y = Y + w;
  else if (item.rot === 180) {
    x = X + w;
    y = Y + h;
  } else if (item.rot === 270) x = X + h;
  sheet.drawPage(item.ep, { x, y, width: w, height: h, rotate: degrees(-item.rot) });
}

// 枠の中央に描く。枠からはみ出す分は切り取る(隣の面にかからないように)
function drawInSlot(sheet, item, slotX, slotY, slotW, slotH, scale) {
  const dispW = item.w * scale;
  const dispH = item.h * scale;
  sheet.pushOperators(pushGraphicsState(), rectangle(slotX, slotY, slotW, slotH), clip(), endPath());
  drawUpright(sheet, item, slotX + (slotW - dispW) / 2, slotY + (slotH - dispH) / 2, scale);
  sheet.pushOperators(popGraphicsState());
}

const WIDE_RATIO = 1.15; // 横幅が高さのこの倍より大きい(横長の)ページは、左右に並べずA4横1枚で

// 指定ページ(0始まりのindex配列)を、A4横の用紙に並べたPDFにする。
// - 縦長のページは2ページずつ左右に並べる。1ページだけ余ったら左側(端)に寄せる
// - 横長のページ(A4横いっぱいの処方箋など)は、左右に並べず A4横1枚をまるごと使う
// - ページの順番は変えない
//   options.crops : ページごとの内容の範囲(表示上の割合)。あれば、その範囲だけを大きく並べる
//   options.turns : ページごとの追加の回転(時計回り・度)。横倒しの処方箋をまっすぐにする
//   options.fit   : "auto"=範囲に合わせて拡大 / "full"=ページ全体
//   options.zoom  : 拡大率の倍率(0.5〜2)。人が調整する
export async function buildTwoUpPdf(srcDoc, pageIndexes, options = {}) {
  const { crops = [], turns = [], fit = "auto", zoom = 1 } = options;
  const out = await PDFDocument.create();
  const slotW = (SHEET_W - MARGIN * 2 - GAP) / 2;
  const slotH = SHEET_H - MARGIN * 2;
  const zoomFactor = Math.min(2, Math.max(0.5, Number(zoom) || 1));

  const items = [];
  for (let k = 0; k < pageIndexes.length; k++) {
    const crop = fit === "auto" ? crops[k] : null;
    items.push(await embedUpright(out, srcDoc.getPage(pageIndexes[k]), crop || null, turns[k] || 0));
  }

  // 縦長のページを左右に並べる(1〜2ページ)
  const drawPair = (pair) => {
    // 左右で同じ倍率にそろえる(大きいほうに合わせる)
    const fitScale = Math.min(...pair.map((it) => Math.min(slotW / it.w, slotH / it.h)));
    const scale = Math.min(fitScale, MAX_SCALE) * zoomFactor;
    const sheet = out.addPage([SHEET_W, SHEET_H]);
    pair.forEach((it, slot) => drawInSlot(sheet, it, MARGIN + slot * (slotW + GAP), MARGIN, slotW, slotH, scale));
    sheet.drawLine({
      start: { x: SHEET_W / 2, y: MARGIN },
      end: { x: SHEET_W / 2, y: SHEET_H - MARGIN },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  // 横長のページを、A4横1枚をまるごと使って大きく
  const drawWide = (it) => {
    const w = SHEET_W - MARGIN * 2;
    const h = SHEET_H - MARGIN * 2;
    const scale = Math.min(Math.min(w / it.w, h / it.h), MAX_SCALE) * zoomFactor;
    const sheet = out.addPage([SHEET_W, SHEET_H]);
    drawInSlot(sheet, it, MARGIN, MARGIN, w, h, scale);
  };

  let pending = [];
  for (const it of items) {
    if (it.w / it.h > WIDE_RATIO) {
      if (pending.length) drawPair(pending);
      pending = [];
      drawWide(it);
    } else {
      pending.push(it);
      if (pending.length === 2) {
        drawPair(pending);
        pending = [];
      }
    }
  }
  if (pending.length) drawPair(pending);

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
export async function buildItemPdf(srcDoc, { kind, source_pages, crops, turns, layout }) {
  const indexes = source_pages.map((n) => n - 1);
  if (kind === "ad") return buildPlainPdf(srcDoc, indexes);
  const cropList = kind === "prescription" ? source_pages.map((n) => crops?.[String(n)] || null) : [];
  return buildTwoUpPdf(srcDoc, indexes, {
    crops: cropList,
    turns: source_pages.map((n) => turns?.[String(n)] || 0),
    fit: layout?.fit === "full" ? "full" : "auto",
    zoom: layout?.zoom || 1,
  });
}

export function sheetCount(kind, pageTotal) {
  return kind === "ad" ? pageTotal : Math.ceil(pageTotal / 2);
}

// できあがったPDFの用紙の枚数(横長のページがあると、ページ数÷2 にならないため)
export async function countSheets(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

// 自動印刷するか(広告以外。古い記録は処方箋だけ)
export function shouldAutoPrint(item) {
  if (item.auto_print !== undefined) return !!item.auto_print;
  return !!item.is_prescription;
}
