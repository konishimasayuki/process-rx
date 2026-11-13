import crypto from "crypto";
import webpush from "web-push";
import { jstDate } from "./_fax-utils.js";

const SUBJECT = "https://process-rx.vercel.app";
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// 通知の初期設定: 月〜土 8:30〜18:30、日曜はなし
export const DEFAULT_PREFS = {
  days: Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { on: d !== 0, from: "08:30", to: "18:30" }])
  ),
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanPrefs(input) {
  const days = {};
  for (let d = 0; d <= 6; d++) {
    const src = input?.days?.[String(d)] || DEFAULT_PREFS.days[String(d)];
    days[String(d)] = {
      on: !!src.on,
      from: TIME_RE.test(src.from || "") ? src.from : "08:30",
      to: TIME_RE.test(src.to || "") ? src.to : "18:30",
    };
  }
  return { days };
}

// いま(日本時間)が、通知してよい曜日・時間帯か
export function withinSchedule(prefs, now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = (prefs?.days || DEFAULT_PREFS.days)[String(jst.getUTCDay())];
  if (!day || !day.on) return false;
  const hm = jst.toISOString().slice(11, 16);
  if (day.from === day.to) return true; // 同じ時刻なら終日
  if (day.from < day.to) return hm >= day.from && hm < day.to;
  return hm >= day.from || hm < day.to; // 夜をまたぐ設定(例: 22:00〜6:00)
}

export const subKey = (endpoint) => `push:sub:${crypto.createHash("sha1").update(String(endpoint)).digest("hex").slice(0, 20)}`;

// 通知のかぎ(VAPID)。初めて使うときに作って保存する
export async function getVapid(redis) {
  let keys = parse(await redis.get("settings:vapid"));
  if (!keys?.publicKey) {
    const created = webpush.generateVAPIDKeys();
    await redis.set("settings:vapid", JSON.stringify(created), { nx: true });
    keys = parse(await redis.get("settings:vapid")) || created;
  }
  return keys;
}

export async function listSubscriptions(redis) {
  const keys = await redis.smembers("push:subs");
  if (keys.length === 0) return [];
  const raw = await redis.mget(...keys);
  return raw.map((r, i) => ({ key: keys[i], ...(parse(r) || {}) })).filter((s) => s.subscription);
}

export async function sendTo(redis, sub, payload) {
  const vapid = await getVapid(redis);
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: "high",
      vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    });
    return true;
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      // 端末側で通知をやめた・アプリを消した → 登録を消す
      await redis.del(sub.key);
      await redis.srem("push:subs", sub.key);
    } else {
      console.error("push failed:", err?.statusCode, String(err?.body || err));
    }
    return false;
  }
}

// その人が最後に受信一覧を見てから届いたFAXの数(アプリのアイコンに出す数)
async function unreadCounts(redis, owners) {
  const ids = await redis.lrange(`fax:date:${jstDate()}`, 0, -1);
  const items = ids.length ? (await redis.mget(...ids.map((id) => `fax:item:${id}`))).map(parse).filter(Boolean) : [];
  const faxes = new Map();
  items.filter((i) => !i.imported && !i.demo).forEach((i) => {
    const t = i.received_at;
    if (!faxes.has(i.fax_id) || faxes.get(i.fax_id) > t) faxes.set(i.fax_id, t);
  });
  const result = {};
  for (const owner of owners) {
    const seen = (await redis.get(`push:seen:${owner}`)) || "";
    result[owner] = [...faxes.values()].filter((t) => t > seen).length;
  }
  return result;
}

// FAXが届いたことを、通知を有効にしている端末に知らせる(曜日・時間帯の設定どおり)
export async function notifyFax(redis, { faxId, sender, patients, others }, now = new Date()) {
  const subs = (await listSubscriptions(redis)).filter((s) => withinSchedule(s.prefs, now));
  if (subs.length === 0) return { sent: 0 };
  const counts = await unreadCounts(redis, [...new Set(subs.map((s) => s.owner))]);
  const parts = [];
  if (patients) parts.push(`処方箋 ${patients}名分`);
  if (others) parts.push(`その他 ${others}件`);
  const results = await Promise.all(
    subs.map((s) =>
      sendTo(redis, s, {
        title: `FAX受信: ${sender || "送信元 不明"}`,
        body: `${parts.join("・") || "FAXが届きました"}`,
        badge: counts[s.owner] || 1,
        tag: `fax-${faxId}`,
        url: "/?tab=fax",
      })
    )
  );
  return { sent: results.filter(Boolean).length };
}
