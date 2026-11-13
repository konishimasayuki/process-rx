// PDFのページを画像にして、内容のある範囲(処方箋の本体)を見つける。
// - pdf.js(PDFを画像に描く)と @napi-rs/canvas(画像を扱う)を使う
// - FAX特有の「受信日時・FAX番号・ページ番号」だけの細い行は、本体に含めない

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // pdf.js は画像の部品(@napi-rs/canvas)を実行時に探して読み込む作りのため、
      // サーバー(Vercel)に確実に含まれるよう、ここで名前を明示して読み込んでおく
      await import("@napi-rs/canvas");
      // ワーカーも自分で読み込んでおく(サーバー環境でファイルを探しに行かせないため)
      const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      globalThis.pdfjsWorker = worker;
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })().catch((err) => {
      pdfjsPromise = null; // 次回やり直せるようにする
      throw err;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  return task.promise;
}

// 指定ページを、横幅 width(px)の画像(canvas)にして返す。turn: さらに時計回りに回す角度
export async function renderPage(doc, pageNumber, width, turn = 0) {
  const page = await doc.getPage(pageNumber);
  const rotation = (((page.rotate + (Number(turn) || 0)) % 360) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const viewport = page.getViewport({ scale: width / base.width, rotation });
  const w = Math.max(1, Math.ceil(viewport.width));
  const h = Math.max(1, Math.ceil(viewport.height));
  const { canvas, context } = doc.canvasFactory.create(w, h);
  await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
  page.cleanup();
  return { canvas, context, width: w, height: h };
}

const INK_LUMINANCE = 210; // これより暗い点を「インク」とみなす(薄い線も拾う)
const CELL_TARGET = 100; // 横を約100マスに分けて調べる(1マス≒1%)

// RGBAの画像から、内容のある範囲を 0〜1 の割合(左上が原点)で返す。見つからなければ null
export function detectContentBox({ data, width, height }) {
  const cell = Math.max(4, Math.round(width / CELL_TARGET));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const counts = new Uint16Array(gw * gh);

  for (let y = 0; y < height; y++) {
    const rowBase = Math.floor(y / cell) * gw;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
      if (lum < INK_LUMINANCE) counts[rowBase + Math.floor(x / cell)]++;
    }
  }

  // ごく小さなゴミ(1〜2点)は無視。紙の縁1マスも無視(スキャンの黒い縁対策)
  const ink = new Uint8Array(gw * gh);
  let totalInk = 0;
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      if (counts[gy * gw + gx] >= 3) {
        ink[gy * gw + gx] = 1;
        totalInk++;
      }
    }
  }
  if (totalInk < 12) return null;

  // 1マス分ふくらませて、近い文字・罫線をひとかたまりにする
  const dil = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!ink[gy * gw + gx]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = gy + dy;
          const nx = gx + dx;
          if (ny >= 0 && ny < gh && nx >= 0 && nx < gw) dil[ny * gw + nx] = 1;
        }
      }
    }
  }

  // つながっているかたまり(連結成分)を調べ、インクが一番多いものを本体とする
  const label = new Int32Array(gw * gh).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < gw * gh; start++) {
    if (!dil[start] || label[start] !== -1) continue;
    const id = comps.length;
    const comp = { mass: 0, x0: gw, y0: gh, x1: -1, y1: -1 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const cur = stack.pop();
      const cy = Math.floor(cur / gw);
      const cx = cur % gw;
      if (ink[cur]) {
        comp.mass += counts[cur];
        comp.x0 = Math.min(comp.x0, cx);
        comp.x1 = Math.max(comp.x1, cx);
        comp.y0 = Math.min(comp.y0, cy);
        comp.y1 = Math.max(comp.y1, cy);
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = cy + dy;
          const nx = cx + dx;
          if (ny < 0 || ny >= gh || nx < 0 || nx >= gw) continue;
          const ni = ny * gw + nx;
          if (dil[ni] && label[ni] === -1) {
            label[ni] = id;
            stack.push(ni);
          }
        }
      }
    }
    if (comp.x1 >= 0) comps.push(comp);
  }
  if (comps.length === 0) return null;

  comps.sort((a, b) => b.mass - a.mass);
  const main = comps[0];
  let { x0, y0, x1, y1 } = main;

  // 本体以外のかたまりをどうするか:
  //  - 本体のすぐ近く(1マス以内)なら含める(印鑑・はみ出た文字など)
  //  - 離れていて、細く薄いもの(FAXの受信日時の行・ページ番号・ゴミ)は外す
  //  - 離れていても、ある程度の大きさがあれば内容とみなして含める(切り落としを避ける)
  const nearMain = (c) => c.x1 >= main.x0 - 1 && c.x0 <= main.x1 + 1 && c.y1 >= main.y0 - 1 && c.y0 <= main.y1 + 1;
  const isStamp = (c) => (c.y1 - c.y0 + 1 <= 3 || c.x1 - c.x0 + 1 <= 2) && c.mass < main.mass * 0.05;
  for (const c of comps.slice(1)) {
    if (!nearMain(c) && isStamp(c)) continue;
    // 近くのものも含め、ごく小さいゴミだけの場合は範囲を広げない
    if (c.mass < main.mass * 0.004 && c.x1 - c.x0 <= 1 && c.y1 - c.y0 <= 1 && !nearMain(c)) continue;
    x0 = Math.min(x0, c.x0);
    x1 = Math.max(x1, c.x1);
    y0 = Math.min(y0, c.y0);
    y1 = Math.max(y1, c.y1);
  }

  // 余白をすこし付ける(1.5マス)
  const pad = 1.5;
  const box = {
    x0: Math.max(0, (x0 - pad) * cell) / width,
    y0: Math.max(0, (y0 - pad) * cell) / height,
    x1: Math.min(width, (x1 + 1 + pad) * cell) / width,
    y1: Math.min(height, (y1 + 1 + pad) * cell) / height,
  };

  // ほぼ全面に内容があるなら、切り取らない(効果が小さく、切りすぎの危険のほうが大きい)
  if (box.x1 - box.x0 > 0.94 && box.y1 - box.y0 > 0.94) return null;
  if (box.x1 - box.x0 < 0.12 || box.y1 - box.y0 < 0.12) return null;
  return box;
}

// PDFの全ページについて、内容の範囲(割合)を調べる。ページごとに失敗しても全体は止めない
export async function analyzePages(buffer, { width = 800 } = {}) {
  const doc = await openPdf(buffer);
  const results = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const { context, width: w, height: h } = await renderPage(doc, n, width);
        const image = context.getImageData(0, 0, w, h);
        results.push(detectContentBox(image));
      } catch (err) {
        console.error("page analyze error:", n, err);
        results.push(null);
      }
    }
  } finally {
    await doc.destroy();
  }
  return results;
}

// 指定ページを横幅 width(px) のPNG画像にする(プレビュー用)
export async function renderPagePng(buffer, pageNumber, width, turn = 0) {
  const doc = await openPdf(buffer);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return { png: null, pageCount: doc.numPages };
    const { canvas } = await renderPage(doc, pageNumber, width, turn);
    return { png: canvas.toBuffer("image/png"), pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
