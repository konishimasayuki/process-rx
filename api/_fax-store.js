// FAXの記録(患者さんごと)の読み込み・まとめ情報の保存(複数のAPIで使う)
import { SAFETY_TTL_SECONDS as TTL } from "./_fax-utils.js";

const CHUNK = 100;

export const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// 1通のFAXの患者さんごとの記録を、ページ順に読み込む
export async function loadFaxItems(redis, faxId) {
  const summary = parse(await redis.get(`fax:hash_items:${faxId}`));
  let items = [];
  if (Array.isArray(summary) && summary.length) {
    items = (await redis.mget(...summary.map((x) => `fax:item:${x.id}`))).map(parse).filter(Boolean);
  }
  if (items.length === 0) {
    // 記録の一覧が無いとき(古いデータ)は、受信一覧全体から探す
    const ids = await redis.lrange("fax:queue", 0, -1);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const raw = await redis.mget(...ids.slice(i, i + CHUNK).map((id) => `fax:item:${id}`));
      raw.map(parse).filter(Boolean).forEach((it) => items.push(it));
    }
  }
  return items
    .filter((it) => it.fax_id === faxId && Array.isArray(it.source_pages) && it.source_pages.length)
    .sort((a, b) => a.source_pages[0] - b.source_pages[0]);
}

// 二重取込の判定・印刷アプリへの返答に使う、1通分のまとめ
export function summaryOf(records) {
  return records.map((r) => ({
    id: r.id,
    pages: r.source_pages,
    patient_name: r.extracted?.patient_name || null,
    is_prescription: r.is_prescription,
    kind: r.kind,
    auto_print: r.auto_print,
    has_pdf: r.has_pdf,
  }));
}

export async function saveSummary(redis, faxId, records) {
  await redis.set(`fax:hash_items:${faxId}`, JSON.stringify(summaryOf(records)), { ex: TTL });
}
