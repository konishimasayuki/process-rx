import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession, isAdmin } from "./_session.js";
import { analyzePages, renderPagePng } from "./_pdf-render.js";
import { buildTwoUpPdf } from "./_pdf-utils.js";
import { Redis } from "@upstash/redis";
import { callClaude, describeAiError } from "./_fax-ai.js";
import { recordAiStatus } from "./_ai-status.js";

// 管理者用の動作確認: 見本のFAX風PDFを作って「画像にする→余白を調べる→拡大して並べる」が動くか確かめる。
// データは保存しない。?png=1 で並べた結果の画像も見られる。
export default async function handler(req, res) {
  const session = await getSession(req);
  if (!isAdmin(session)) return res.status(session ? 403 : 401).json({ error: "管理者のみ" });

  // ?ai=1 … AIにつながるか(残高・キー・モデル)を、ごく小さな問い合わせで確かめる
  if (req.query?.ai === "1") {
    const models = [
      ["ページ分け・処方内容の読み取り", process.env.CLAUDE_MODEL || "claude-sonnet-5-5"],
      ["向きの判定", process.env.CLAUDE_MODEL_ORIENT || "claude-haiku-5-5"],
    ];
    const results = [];
    for (const [purpose, model] of models) {
      try {
        await callClaude({
          system: "返事は ok の2文字だけ。",
          content: [{ type: "text", text: "接続確認です。ok と返してください。{ }" }],
          maxTokens: 400,
          timeoutMs: 15_000,
          model,
        }).catch((err) => {
          // 返事が JSON でなくても、つながってさえいれば良い
          if (err?.kind === "parse") return null;
          throw err;
        });
        results.push({ purpose, model, ok: true });
      } catch (err) {
        results.push({ purpose, model, ok: false, ...describeAiError(err), detail: String(err?.apiMessage || err?.message || "").slice(0, 300) });
      }
    }
    const allOk = results.every((r) => r.ok);
    const mainOk = results[0].ok;
    await recordAiStatus(Redis.fromEnv(), mainOk ? null : { kind: "api", status: results[0].code === "no_credit" ? 400 : undefined, apiMessage: results[0].code === "no_credit" ? "credit balance" : results[0].message });
    res.status(200).json({
      ok: allOk,
      summary: allOk ? "AIにつながっています" : mainOk ? "向きの判定のAIだけつながりません(ページ分けは動きます)" : "AIにつながりません",
      results,
    });
    return;
  }

  const started = Date.now();
  const report = { steps: [] };
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 2; n++) {
      const page = doc.addPage([595.28, 841.89]);
      page.drawText(`2026-11-13 10:11:09 AM JST   0924103332   ${n} / 2`, { x: 36, y: 842 * 0.85, size: 9, font });
      page.drawRectangle({ x: 40, y: 842 * 0.2, width: 350, height: 842 * 0.6, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
      for (let i = 1; i < 6; i++) {
        const y = 842 * 0.2 + i * 70;
        page.drawLine({ start: { x: 40, y }, end: { x: 390, y }, thickness: 1, color: rgb(0, 0, 0) });
        page.drawText(`${i} Drug name sample`, { x: 50, y: y - 22, size: 11, font });
      }
    }
    const bytes = Buffer.from(await doc.save());
    report.steps.push({ step: "見本PDFを作成", ok: true });

    const boxes = await analyzePages(bytes);
    report.steps.push({ step: "余白の検出", ok: boxes.every(Boolean), boxes });

    const src = await PDFDocument.load(bytes);
    const merged = Buffer.from(await buildTwoUpPdf(src, [0, 1], { crops: boxes, fit: "auto", zoom: 1 }));
    report.steps.push({ step: "拡大して左右に並べる", ok: merged.length > 0, bytes: merged.length });

    const { png, pageCount } = await renderPagePng(merged, 1, 900);
    report.steps.push({ step: "画像に変換", ok: !!png && pageCount === 1, png_bytes: png?.length || 0 });

    report.ok = report.steps.every((s) => s.ok);
    report.ms = Date.now() - started;
    if (req.query?.png === "1" && png) {
      res.setHeader("Content-Type", "image/png");
      res.status(200).send(png);
      return;
    }
    res.status(200).json(report);
  } catch (err) {
    console.error("selftest failed:", err);
    res.status(500).json({ ok: false, error: String(err?.stack || err), steps: report.steps });
  }
}
