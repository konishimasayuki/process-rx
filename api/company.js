import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { getCompany } from "./_company.js";
import { geocodeAddress } from "./_delivery-utils.js";

const redis = Redis.fromEnv();

// 会社の住所と、出勤・退勤を押せる範囲(m)
export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });

  if (req.method === "GET") {
    res.status(200).json({ company: await getCompany(redis) });
    return;
  }

  if (req.method === "POST") {
    if (!isAdmin(session)) return res.status(403).json({ error: "管理者のみ操作できます" });
    const address = String(req.body?.address || "").trim();
    const radius = Math.round(Number(req.body?.radius_m) || 0);
    if (!address) return res.status(400).json({ error: "住所を入力してください" });
    if (radius < 30 || radius > 5000) return res.status(400).json({ error: "範囲は30〜5000mで入力してください" });
    const geo = await geocodeAddress(address);
    if (!geo) return res.status(400).json({ error: "住所から場所を特定できませんでした" });
    const company = { address, radius_m: radius, lat: geo.lat, lng: geo.lng };
    await redis.set("settings:company", JSON.stringify(company));
    res.status(200).json({ status: "ok", company });
    return;
  }

  res.status(405).json({ error: "GET/POSTのみ対応しています" });
}
