import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const EXTRACT_SYSTEM_PROMPT = `あなたは調剤薬局向けシステムのアシスタントです。
FAXで届いた処方箋のPDFから、以下の情報を可能な限り正確に抽出し、JSON形式のみで出力してください。
前置き・説明文・Markdownのコードフェンスは一切不要です。JSONオブジェクトのみを返してください。

出力スキーマ:
{
  "patient_name": "患者氏名（カナがあればカナも）",
  "patient_kana": "患者氏名カナ（不明ならnull）",
  "birth_date": "生年月日（YYYY-MM-DD形式、不明ならnull）",
  "sex": "男 or 女（不明ならnull）",
  "insurance_info": "保険情報・記号番号など読み取れる範囲でそのまま",
  "issuing_institution": "医療機関名",
  "doctor_name": "医師名（不明ならnull）",
  "issue_date": "処方箋発行日（YYYY-MM-DD形式、不明ならnull）",
  "drugs": [
    {
      "name": "薬品名",
      "dosage": "用量（1回量など、記載の通り）",
      "usage": "用法（食後・1日3回など、記載の通り）",
      "days_or_quantity": "日数または総量、記載の通り"
    }
  ],
  "notes": "備考・特記事項（残薬確認依頼、後発品変更不可などがあれば）",
  "has_qr": "処方箋画像内にQRコードらしきものが見えるか true/false",
  "confidence": "全体的な読み取り自信度 high/medium/low",
  "unclear_fields": ["読み取りに自信が持てなかった項目名の配列"]
}

読み取れない項目はnullにしてください。憶測で埋めないでください。`;

async function extractPrescription(base64Pdf, anthropicApiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system: EXTRACT_SYSTEM_PROMPT,
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
              text: "この処方箋PDFの内容を指定のJSONスキーマで抽出してください。",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("Anthropic APIからテキスト応答が得られませんでした");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
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

  const { filename, pdf_base64 } = req.body || {};

  if (!filename || !pdf_base64) {
    res.status(400).json({ error: "filename と pdf_base64 は必須です" });
    return;
  }

  const alreadyProcessed = await redis.sismember("fax:processed_filenames", filename);
  if (alreadyProcessed) {
    res.status(200).json({ status: "duplicate", filename });
    return;
  }

  let extracted;
  try {
    extracted = await extractPrescription(pdf_base64, process.env.ANTHROPIC_API_KEY);
  } catch (err) {
    res.status(500).json({ error: "処方箋解析に失敗しました", detail: String(err) });
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    filename,
    received_at: new Date().toISOString(),
    status: "pending",
    extracted,
  };

  await redis.set(`fax:item:${id}`, JSON.stringify(record));
  await redis.rpush("fax:queue", id);
  await redis.sadd("fax:processed_filenames", filename);

  res.status(200).json({ status: "ok", id, extracted });
}
