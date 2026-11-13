import { PDFDocument, degrees } from "pdf-lib";
import { normalizeText } from "./_fax-utils.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// ---------- Claude 呼び出し ----------

class AiError extends Error {
  constructor(message, kind, status, apiMessage) {
    super(message);
    this.kind = kind; // "api" | "timeout" | "truncated" | "parse"
    this.status = status; // APIのHTTP状態(あれば)
    this.apiMessage = apiMessage; // APIが返したエラーの文面(あれば)
  }
}

// AIの失敗を、画面に出せる種類と日本語の説明にする
export function describeAiError(err) {
  const status = err?.status;
  const msg = String(err?.apiMessage || err?.message || "").toLowerCase();
  if (err?.kind === "timeout") return { code: "timeout", message: "AIの応答に時間がかかりすぎました" };
  if (err?.kind === "truncated") return { code: "truncated", message: "AIの回答が長すぎて途中で切れました" };
  if (err?.kind === "parse") return { code: "parse", message: "AIの回答を読み取れませんでした" };
  if (status === 400 && msg.includes("credit balance"))
    return { code: "no_credit", message: "AIの利用残高が足りません(Anthropicのクレジットを追加してください)" };
  if (status === 401 || status === 403)
    return { code: "auth", message: "AIのAPIキーが無効か、権限がありません(Vercelの ANTHROPIC_API_KEY を確認してください)" };
  if (status === 404) return { code: "model", message: "AIのモデルが見つかりません(Vercelの CLAUDE_MODEL を確認してください)" };
  if (status === 429) return { code: "rate_limit", message: "AIの利用制限に達しています(少し待つと直ります)" };
  if (status === 529 || (status >= 500 && status < 600)) return { code: "overloaded", message: "AIが混み合っています(少し待つと直ります)" };
  return { code: "other", message: `AIの呼び出しに失敗しました(${status || "通信エラー"})` };
}

// 待ってやり直せば直る可能性があるか(残高不足・キーの間違いなどは、待っても直らない)
export function isRetryable(err) {
  return ["timeout", "rate_limit", "overloaded", "parse"].includes(describeAiError(err).code);
}

// ---- モデルごとの「考える量」の指定 ----
// Claude 5.5系は、何も指定しないと答える前に長く考える(Sonnetは初期値が重い)。
// 考えた分も返事の長さの上限に含まれ、出力の料金もかかる。FAXの読み取りに長い思考は要らないので、軽くする。
//   Sonnet 5.5: 思考を止める指定(disabled)は使えない → between_tools(前もって考えない) + effort low
//   Haiku 5.5 : thinking を無効にでき、effort は low
// effort は AI_EFFORT で変えられる(low / medium / high)
function modelOptions(model) {
  const effort = process.env.AI_EFFORT || "low";
  if (/haiku-5-5/.test(model)) return { thinking: { type: "disabled" }, output_config: { effort } };
  if (/sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" }, output_config: { effort } };
  return {};
}

// 1回分の送信。extra は thinking / output_config など、モデルごとの追加の指定
async function callOnce({ system, pdfBase64, text, content, maxTokens, timeoutMs, model, extra }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...extra,
        system,
        messages: [
          {
            role: "user",
            content: content || [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
              { type: "text", text },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new AiError(String(err), controller.signal.aborted ? "timeout" : "api");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    let apiMessage = "";
    try {
      apiMessage = JSON.parse(text)?.error?.message || "";
    } catch {
      apiMessage = text.slice(0, 200);
    }
    throw new AiError(`Anthropic API error: ${response.status} ${text}`, "api", response.status, apiMessage);
  }
  const data = await response.json();
  if (data.stop_reason === "max_tokens") {
    throw new AiError("回答が長すぎて途中で切れました", "truncated");
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw new AiError("テキスト応答がありません", "parse");
  const body = block.text.replace(/```json|```/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new AiError("JSONが見つかりません", "parse");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new AiError(`JSONを読めません: ${err.message}`, "parse");
  }
}

// content を渡すと、その内容をそのまま送る(画像など)。渡さなければ、PDF + text を送る
// model を渡すと、そのモデルで呼ぶ(向きの判定は小さく安いモデルを使う)
// 次の場合は、自動でやり直す(合計の制限時間 timeoutMs の範囲で):
//   - 「考える量」の指定をAIが受け付けなかったとき → 指定なしで
//   - 返事が長すぎて切れたとき → 上限を3倍にして
export async function callClaude(opts) {
  const model = opts.model || MODEL;
  const deadline = Date.now() + Math.max(1000, opts.timeoutMs);
  let extra = modelOptions(model);
  let maxTokens = opts.maxTokens;
  let truncatedRetried = false;
  for (let i = 0; i < 3; i++) {
    try {
      return await callOnce({ ...opts, model, extra, maxTokens, timeoutMs: deadline - Date.now() });
    } catch (err) {
      const msg = String(err?.apiMessage || "").toLowerCase();
      const timeLeft = deadline - Date.now() > 4000;
      if (err?.status === 400 && Object.keys(extra).length && /thinking|effort|output_config/.test(msg) && timeLeft) {
        console.error("thinking/effort rejected, retry without:", msg.slice(0, 120));
        extra = {};
        continue;
      }
      if (err?.kind === "truncated" && !truncatedRetried && timeLeft) {
        truncatedRetried = true;
        maxTokens = Math.min(32_000, maxTokens * 3);
        continue;
      }
      throw err;
    }
  }
  throw new AiError("AIの呼び出しをやり直せませんでした", "api");
}


// ---------- 1段階目: ページごとに、区分と患者さんの本人情報だけを短く読む ----------

const CLASSIFY_PROMPT = `あなたは調剤薬局のFAX受付担当です。
FAXで届いた1通分のPDFが渡されます。複数の患者さんの処方箋や、送付状・広告が順番に入っていることがあります。
各ページについて、区分と、患者さんを見分けるための情報だけを読み取ってください。

区分(kind):
  "prescription" = 処方箋
  "cover" = 送付状・表紙・連絡文・問い合わせ・疑義照会など、処方箋以外の業務連絡
  "ad" = 宣伝・広告・営業チラシ・製薬会社や卸の案内など(明らかな宣伝のときだけ)

FAXの画質が粗くても、文字の形から最も確からしい読みを書いてください。
氏名とフリガナ(ふりがな)は両方読むこと。どちらか片方しか読めないときも、読めたほうを書く。
保険者番号・記号番号・生年月日は、同じ人のページかどうかの判断に使うので、読めた範囲で書く。
読めない項目はnullにする(推測で作らない)。

文字の向き(text_top): 送る側が用紙を横にして送ったなどで、ページ画像の中で処方箋が横倒し・逆さまになっていることがある。
処方箋の本体(「処方箋」の表題や患者名などの文字)の「文字の上側」が、ページ画像のどちらを向いているかを答える。
  "up" = 普通に読める向き / "right" = 文字の上側が右を向いている(右に倒れている) /
  "down" = 逆さま / "left" = 文字の上側が左を向いている(左に倒れている)
FAXの端に入る受信日時・FAX番号などのヘッダー行ではなく、処方箋の本体の文字で判断すること。

出力はJSONオブジェクトのみ(前置き・説明・コードフェンスは不要):
{
  "sender": "このFAXの送信元(医療機関名)。FAXの端の送信元表示・送付状・処方箋の医療機関名から。不明ならnull",
  "pages": [
    {
      "page": 1,
      "kind": "prescription",
      "patient_name": "氏名",
      "patient_kana": "フリガナ",
      "birth_date": "YYYY-MM-DD",
      "insurer_number": "保険者番号(数字)",
      "insured_symbol_number": "被保険者証の記号・番号",
      "institution": "医療機関名",
      "continues_previous": false,
      "text_top": "up"
    }
  ]
}
continues_previous は、そのページが直前のページの続き(2枚目・裏面・続紙など)なら true。
pages には、すべてのページを1ページずつ、順番どおりに入れること。`;

export async function classifyPages(pdfBase64, pageCount, timeoutMs) {
  const result = await callClaude({
    system: CLASSIFY_PROMPT,
    pdfBase64,
    text: `このPDFは全${pageCount}ページです。ページごとに読み取ってください。`,
    // 上限が低いと、考えただけで使い切って答えが切れる。上限を上げても、使った分しか料金はかからない
    maxTokens: Math.min(16_000, 4_000 + pageCount * 300),
    timeoutMs,
  });
  return {
    sender: result.sender || null,
    pages: Array.isArray(result.pages) ? result.pages : [],
  };
}

// ---------- 同じ人のページをまとめる(氏名・フリガナ・生年月日・保険者番号で判断) ----------

const zenkakuToHankaku = (s) =>
  String(s || "").replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const clean = (s) => normalizeText(zenkakuToHankaku(s)).replace(/[^\p{L}\p{N}]/gu, "");
const digits = (s) => zenkakuToHankaku(s).replace(/[^0-9]/g, "");

function identityOf(p) {
  return {
    name: clean(p.patient_name),
    kana: clean(p.patient_kana),
    birth: (p.birth_date || "").slice(0, 10),
    insurer: digits(p.insurer_number),
    insured: clean(p.insured_symbol_number),
  };
}

const hasIdentity = (id) => !!(id.name || id.kana || (id.insurer && id.insured));

export function samePerson(a, b) {
  // はっきり違う情報があれば別人
  if (a.birth && b.birth && a.birth !== b.birth) return false;
  if (a.insurer && b.insurer && a.insurer !== b.insurer) return false;
  if (a.insured && b.insured && a.insured !== b.insured) return false;
  if (a.kana && b.kana) return a.kana === b.kana;
  if (a.name && b.name) return a.name === b.name;
  if (a.insurer && b.insurer && a.insured && b.insured) return true; // 番号がすべて一致
  return false;
}

function mergeIdentity(target, from) {
  for (const k of Object.keys(target)) if (!target[k] && from[k]) target[k] = from[k];
}

// 1段階目の結果から、ページのまとまり(グループ)を作る
// 文字の上側の向き → まっすぐにするために時計回りに回す角度
const TURN_BY_TEXT_TOP = { up: 0, right: 270, down: 180, left: 90 };
export function turnFromTextTop(textTop) {
  return TURN_BY_TEXT_TOP[String(textTop || "").toLowerCase()] ?? 0;
}

export function groupPages(pageInfos, pageCount, orientTurns = {}) {
  const byPage = new Map();
  for (const p of pageInfos) {
    const n = Number(p.page);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount && !byPage.has(n)) byPage.set(n, p);
  }

  const groups = [];
  let cur = null;
  for (let n = 1; n <= pageCount; n++) {
    const info = byPage.get(n) || {};
    const kind = ["prescription", "cover", "ad"].includes(info.kind) ? info.kind : "prescription";
    const id = identityOf(info);

    let join = false;
    if (cur && cur.kind === kind) {
      if (kind === "prescription") {
        // 本人情報が一致すれば同じ人。情報が読めないページは「続き」の印があるときだけつなげる
        join = hasIdentity(id) ? samePerson(cur.identity, id) : info.continues_previous === true;
      } else if (kind === "ad") {
        join = true; // 広告が続くときは1つにまとめる
      } else {
        join = info.continues_previous === true;
      }
    }

    // 向き: 専用の判定(4枚から読める1枚を選ぶ)があればそれを使い、無いページだけページ分けの読み取りの答えを使う
    const turn = orientTurns[n] !== undefined ? orientTurns[n] : turnFromTextTop(info.text_top);
    if (join) {
      cur.pages.push(n);
      mergeIdentity(cur.identity, id);
      cur.infos.push(info);
      if (turn) cur.turns[String(n)] = turn;
    } else {
      cur = { pages: [n], kind, identity: { ...id }, infos: [info], turns: turn ? { [String(n)]: turn } : {} };
      groups.push(cur);
    }
  }
  return groups;
}

// 1段階目で読めた本人情報(詳しい読み取りに失敗したときの代わり)
export function basicExtracted(group) {
  const pick = (key) => group.infos.map((i) => i[key]).find((v) => v) || null;
  const name = pick("patient_name");
  return name || pick("patient_kana")
    ? {
        patient_name: name,
        patient_kana: pick("patient_kana"),
        birth_date: pick("birth_date"),
        insurer_number: pick("insurer_number"),
        insured_symbol_number: pick("insured_symbol_number"),
        issuing_institution: pick("institution"),
        rps: [],
        confidence: "low",
        partial: true,
      }
    : null;
}

// ---------- 2段階目: 患者さんごとに、処方内容まで詳しく読む ----------

const EXTRACT_PROMPT = `あなたは調剤薬局のスタッフです。1人の患者さんの処方箋(1〜数ページ)のPDFが渡されます。
FAXの画質が粗くても、文字の形から最も確からしい読みを書いてください。読めない項目はnull(推測で作らない)。

処方は「(1)」「(2)」…の項(Rp)ごとにまとめる。1つの項には複数の薬があり、用法と日数(または回数)は項ごとに1つ。
2ページ目に続く項(例: 1ページ目が(1)〜(5)、2ページ目が(6))も、番号どおりにすべて入れる。

出力はJSONオブジェクトのみ(前置き・説明・コードフェンスは不要):
{
  "patient_name": "氏名",
  "patient_kana": "フリガナ",
  "birth_date": "YYYY-MM-DD",
  "sex": "男 or 女",
  "insurer_number": "保険者番号",
  "insured_symbol_number": "被保険者証の記号・番号",
  "public_payer_number": "公費負担者番号",
  "public_recipient_number": "公費負担医療の受給者番号",
  "issuing_institution": "医療機関名",
  "doctor_name": "保険医氏名",
  "issue_date": "交付年月日 YYYY-MM-DD",
  "rps": [
    { "no": 1, "drugs": [ { "name": "薬品名(規格まで)", "amount": "1回量や総量(例: 2錠)" } ], "usage": "用法(例: 1日2回朝夕食後)", "days": "日数・回数(例: 14日分)" }
  ],
  "notes": "備考欄の内容",
  "has_qr": false,
  "confidence": "high/medium/low",
  "unclear_fields": ["読み取りに自信がない項目名"]
}`;

// 指定ページだけのPDF。横倒しのページは、まっすぐに回してからAIに読ませる(読み取りの精度が上がる)
// 名前・保険者番号などの本人情報だけを読む軽い版(処方内容の薬は読まない)
const LIGHT_EXTRACT_PROMPT = `あなたは調剤薬局のスタッフです。1人の患者さんの処方箋(1〜数ページ)のPDFが渡されます。
患者さんを見分けるための情報だけを読み取ってください。処方内容(薬・用法・日数)は読みません。
FAXの画質が粗くても、文字の形から最も確からしい読みを書いてください。読めない項目はnull(推測で作らない)。
氏名とフリガナ(ふりがな)は両方読むこと。

出力はJSONオブジェクトのみ(前置き・説明・コードフェンスは不要):
{
  "patient_name": "氏名",
  "patient_kana": "フリガナ",
  "birth_date": "YYYY-MM-DD",
  "sex": "男 or 女",
  "insurer_number": "保険者番号",
  "insured_symbol_number": "被保険者証の記号・番号",
  "issuing_institution": "医療機関名",
  "confidence": "high/medium/low"
}`;

async function subsetBase64(srcDoc, pages, turns = {}) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(srcDoc, pages.map((n) => n - 1));
  copied.forEach((p, i) => {
    const turn = turns[String(pages[i])] || 0;
    if (turn) p.setRotation(degrees(((p.getRotation().angle || 0) + turn) % 360));
    out.addPage(p);
  });
  return Buffer.from(await out.save()).toString("base64");
}

// light: true … 本人情報だけを読む(処方内容は読まない。出力が少なく、安い)
export async function extractGroup(srcDoc, group, timeoutMs, { light = false } = {}) {
  const pdfBase64 = await subsetBase64(srcDoc, group.pages, group.turns || {});
  return callClaude({
    system: light ? LIGHT_EXTRACT_PROMPT : EXTRACT_PROMPT,
    pdfBase64,
    text: `この患者さんの処方箋(全${group.pages.length}ページ)を読み取ってください。`,
    maxTokens: light ? 3_000 : 8_000,
    timeoutMs,
  });
}

// 1段階目の本人情報で、詳しい読み取りの空欄を補う
export function fillFromBasic(extracted, group) {
  const basic = basicExtracted(group) || {};
  const out = { ...extracted };
  for (const key of ["patient_name", "patient_kana", "birth_date", "insurer_number", "insured_symbol_number", "issuing_institution"]) {
    if (!out[key] && basic[key]) out[key] = basic[key];
  }
  if (!Array.isArray(out.rps)) out.rps = [];
  return out;
}

export { AiError };
