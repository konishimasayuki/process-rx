import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";
import { RETENTION_DAYS, jstDate, shiftDate, normalizeText } from "./_fax-utils.js";

const redis = Redis.fromEnv();
const SEARCH_DAYS = RETENTION_DAYS + 1; // 残している日数(今日+過去3日)

async function itemsForDates(dates) {
  const idLists = await Promise.all(dates.map((d) => redis.lrange(`fax:date:${d}`, 0, -1)));
  const ids = [...new Set(idLists.flat())];
  if (ids.length === 0) return [];
  const raw = await redis.mget(...ids.map((id) => `fax:item:${id}`));
  return raw.filter(Boolean).map((r) => (typeof r === "string" ? JSON.parse(r) : r));
}

// 画面に表示する時刻で並べる(取り込んだ過去分は元の受信時刻)
const sortTime = (it) => new Date(it.imported && it.original_time ? it.original_time : it.received_at);

function sortItems(items) {
  return items.sort((a, b) => {
    const t = sortTime(b) - sortTime(a);
    return t !== 0 ? t : (a.group_index || 0) - (b.group_index || 0);
  });
}

// FAX受信一覧
//   ?date=YYYY-MM-DD … その日に受信した分(省略時は今日)
//   ?q=キーワード     … 残している期間(今日+過去3日)から患者名・フリガナ・送信元で検索
// あわせて、残している日ごとの件数(counts)を返す
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }
  if (!(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  const today = jstDate();
  const { date, q } = req.query || {};
  const last7 = Array.from({ length: RETENTION_DAYS + 1 }, (_, i) => shiftDate(today, -i));
  const lens = await Promise.all(last7.map((d) => redis.llen(`fax:date:${d}`)));
  const counts = Object.fromEntries(last7.map((d, i) => [d, lens[i] || 0]));

  if (q && String(q).trim()) {
    const needle = normalizeText(q);
    const days = Array.from({ length: SEARCH_DAYS }, (_, i) => shiftDate(today, -i));
    const items = (await itemsForDates(days)).filter((it) =>
      [it.extracted?.patient_name, it.extracted?.patient_kana, it.sender, it.extracted?.issuing_institution]
        .some((v) => v && normalizeText(v).includes(needle))
    );
    res.status(200).json({ items: sortItems(items), counts, today });
    return;
  }

  const target = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : today;
  res.status(200).json({ items: sortItems(await itemsForDates([target])), counts, today, date: target });
}
