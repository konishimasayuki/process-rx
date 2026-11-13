import { Redis } from "@upstash/redis";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { buildItemPdf, normalizeGroups, sheetCount } from "./_pdf-utils.js";
import { analyzePages } from "./_pdf-render.js";
import { jstDate, pickSender } from "./_fax-utils.js";

const redis = Redis.fromEnv();

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const PDF_TTL_SECONDS = 60 * 60 * 24 * 60; // 合体PDFは60日保存
const MAX_STORED_PDF_BASE64 = 9_000_000; // Upstashのリクエスト上限(10MB)に収める

const SYSTEM_PROMPT = `あなたは調剤薬局向けシステムのアシスタントです。
FAXで届いた1通分のPDFが渡されます。1通のFAXの中には、複数の患者さんの処方箋が順番に入っていることがあります
(例: 全5ページなら、患者Aが2ページ、患者Bが2ページ、患者Cが1ページ、のように)。

やること:
1. 連続するページを「同じ患者さん」ごとにグループ分けする。
   - 患者氏名・生年月日・保険者番号・医療機関などで同じ人かを判断する。
   - 処方箋の2枚目、裏面、薬剤情報、お薬手帳の写し、疑義照会の回答などの続きのページは、直前の患者さんのグループに入れる。
   - 各グループに区分(kind)を付ける:
       "prescription" = 処方箋(患者さんごと)
       "cover" = 送付状・表紙・連絡文・問い合わせ・疑義照会など、処方箋以外の業務連絡
       "ad" = 宣伝・広告・営業チラシ・製薬会社や卸の案内・キャンペーンなど
     迷ったときは、処方箋は "prescription"、業務に関わる連絡は "cover" にする("ad" は明らかな宣伝だけ)。
   - すべてのページを、必ずちょうど1つのグループに入れる。ページ番号は1始まり。
2. 各グループについて、処方箋の内容を読み取る。

3. このFAXの送信元(送ってきた医療機関・薬局名)を読み取る。FAXの上端の送信元表示や送付状、処方箋の医療機関名から判断する。

出力はJSONオブジェクトのみ(前置き・説明・コードフェンスは不要):
{
  "sender": "送信元の医療機関名(不明ならnull)",
  "groups": [
    {
      "pages": [1, 2],
      "kind": "prescription",
      "extracted": {
        "patient_name": "患者氏名",
        "patient_kana": "患者氏名カナ(不明ならnull)",
        "birth_date": "YYYY-MM-DD(不明ならnull)",
        "sex": "男 or 女(不明ならnull)",
        "insurance_info": "保険情報・記号番号など読み取れる範囲でそのまま",
        "issuing_institution": "医療機関名",
        "doctor_name": "医師名(不明ならnull)",
        "issue_date": "処方箋発行日 YYYY-MM-DD(不明ならnull)",
        "drugs": [
          {
            "name": "薬品名",
            "dosage": "用量(記載の通り)",
            "usage": "用法(記載の通り)",
            "days_or_quantity": "日数または総量(記載の通り)"
          }
        ],
        "notes": "備考・特記事項",
        "has_qr": true,
        "confidence": "high/medium/low",
        "unclear_fields": ["読み取りに自信が持てなかった項目名"]
      }
    }
  ]
}

読み取れない項目はnullにしてください。憶測で埋めないでください。
kind が prescription 以外のグループの extracted は null にしてください。`;

async function analyzeFax(base64Pdf, pageCount, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: `このPDFは全${pageCount}ページです。患者さんごとにページをグループ分けし、指定のJSONで出力してください。`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Anthropic API error: ${response.status} ${errText}`);
    err.isApiError = true;
    throw err;
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claudeからテキスト応答がありません");

  const text = textBlock.text.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSONが見つかりません");
  return JSON.parse(text.slice(start, end + 1));
}

export default async function handler(req, res) {
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
    res.status(200).json({ status: "duplicate", filename, items, ids: items.map((x) => x.id) });
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

  // 1) 患者さんごとのページ分類 + 内容読み取り
  // 0) 各ページの「処方箋の本体の範囲」を調べる(余白を除いて大きく印刷するため)。失敗しても取込は続ける
  const crops = {};
  if (pageCount <= 20) {
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
  }

  let rawGroups = null;
  let rawSender = null;
  try {
    const analysis = await analyzeFax(pdf_base64, pageCount, process.env.ANTHROPIC_API_KEY);
    rawGroups = analysis.groups;
    rawSender = analysis.sender;
  } catch (err) {
    if (err.isApiError) {
      // 通信・APIエラーは再試行できるよう失敗として返す(watcherが次回また送る)
      res.status(500).json({ error: "FAX解析に失敗しました", detail: String(err) });
      return;
    }
    // 応答の形式が崩れた場合は、全ページを要確認の単独グループとして取り込む(取りこぼし防止)
    console.error("fax analysis parse error:", err);
  }

  const groups = normalizeGroups(rawGroups, pageCount);
  const sender = pickSender(rawSender, groups);
  const dateKey = `fax:date:${jstDate()}`;

  // 2) グループごとにA4横・左右2面のPDFを作って保存
  const receivedAt = new Date().toISOString();
  const createdIds = [];
  const summaryItems = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const id = `${contentHash}-${i + 1}`;
    const itemKey = `fax:item:${id}`;

    const layout = { fit: "auto", zoom: 1 };
    const groupCrops = Object.fromEntries(g.pages.filter((n) => crops[String(n)]).map((n) => [String(n), crops[String(n)]]));
    const mergedBytes = await buildItemPdf(srcDoc, {
      kind: g.kind,
      source_pages: g.pages,
      crops: groupCrops,
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
      sheet_count: sheetCount(g.kind, g.pages.length),
      kind: g.kind,
      is_prescription: g.is_prescription,
      auto_print: g.kind !== "ad", // 広告以外は自動で印刷する
      needs_review: g.kind === "prescription" && (g.needs_review || !g.extracted),
      crops: groupCrops,
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
    summaryItems.push({
      id,
      pages: g.pages,
      patient_name: g.extracted?.patient_name || null,
      is_prescription: g.is_prescription,
      kind: g.kind,
      auto_print: g.kind !== "ad",
      has_pdf: hasPdf,
    });
  }

  // 元のPDFは、拡大率の調整などで作り直すために保存しておく
  if (pdf_base64.length <= MAX_STORED_PDF_BASE64) {
    await redis.set(`fax:src:${contentHash}`, pdf_base64, { ex: PDF_TTL_SECONDS });
  }

  await redis.set(`fax:hash_items:${contentHash}`, JSON.stringify(summaryItems), {
    ex: PDF_TTL_SECONDS,
  });
  await redis.sadd("fax:processed_hashes", contentHash);
  await redis.sadd("fax:processed_filenames", filename);

  res.status(200).json({
    status: "ok",
    pages: pageCount,
    groups: groups.map((g) => g.pages),
    ids: createdIds,
    items: summaryItems,
  });
}
