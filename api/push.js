import { Redis } from "@upstash/redis";
import { getSession } from "./_session.js";
import { DEFAULT_PREFS, cleanPrefs, getVapid, sendTo, subKey } from "./_push.js";

const redis = Redis.fromEnv();
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// スマホの通知(プッシュ通知・アイコンの件数バッジ)
//   GET  ?endpoint=…            … 通知のかぎ(公開鍵)と、この端末の設定
//   POST { action: "subscribe", subscription, prefs } … この端末で通知を受け取る
//   POST { action: "prefs", endpoint, prefs }          … 曜日・時間帯を変える
//   POST { action: "unsubscribe", endpoint }           … この端末の通知をやめる
//   POST { action: "test", endpoint }                  … テスト通知
//   POST { action: "seen" }                            … 受信一覧を見た(アイコンの件数を0に)
export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });
  const owner = session.employee_id || "master";

  if (req.method === "GET") {
    const vapid = await getVapid(redis);
    const endpoint = req.query?.endpoint;
    const sub = endpoint ? parse(await redis.get(subKey(endpoint))) : null;
    res.status(200).json({
      publicKey: vapid.publicKey,
      subscribed: !!sub,
      prefs: sub?.prefs || DEFAULT_PREFS,
    });
    return;
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET/POSTのみ対応しています" });
  const body = req.body || {};

  if (body.action === "subscribe") {
    const s = body.subscription;
    if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) {
      return res.status(400).json({ error: "通知の登録情報が不正です" });
    }
    const key = subKey(s.endpoint);
    const prev = parse(await redis.get(key));
    const record = {
      subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
      owner,
      name: session.name,
      prefs: cleanPrefs(body.prefs || prev?.prefs),
      created_at: prev?.created_at || new Date().toISOString(),
      user_agent: String(req.headers["user-agent"] || "").slice(0, 200),
    };
    await redis.set(key, JSON.stringify(record));
    await redis.sadd("push:subs", key);
    res.status(200).json({ status: "ok", prefs: record.prefs });
    return;
  }

  if (body.action === "seen") {
    await redis.set(`push:seen:${owner}`, new Date().toISOString());
    res.status(200).json({ status: "ok" });
    return;
  }

  const key = body.endpoint ? subKey(body.endpoint) : null;
  const record = key ? parse(await redis.get(key)) : null;
  if (!record) return res.status(404).json({ error: "この端末は通知に登録されていません" });

  if (body.action === "prefs") {
    record.prefs = cleanPrefs(body.prefs);
    await redis.set(key, JSON.stringify(record));
    res.status(200).json({ status: "ok", prefs: record.prefs });
    return;
  }
  if (body.action === "unsubscribe") {
    await redis.del(key);
    await redis.srem("push:subs", key);
    res.status(200).json({ status: "ok" });
    return;
  }
  if (body.action === "test") {
    const sent = await sendTo(redis, { key, ...record }, {
      title: "process-rx",
      body: "テスト通知です。FAXが届くと、このようにお知らせします。",
      badge: 1,
      tag: "test",
      url: "/?tab=fax",
    });
    res.status(sent ? 200 : 502).json(sent ? { status: "ok" } : { error: "通知を送れませんでした" });
    return;
  }

  res.status(400).json({ error: "操作が不正です" });
}
