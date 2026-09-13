import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = Redis.fromEnv();

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12時間

// 仮運用: z/z固定。将来的にRedis管理のユーザーテーブルに置き換え予定。
const TEMP_USERNAME = process.env.LOGIN_USERNAME || "z";
const TEMP_PASSWORD = process.env.LOGIN_PASSWORD || "z";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const { username, password } = req.body || {};

  if (username !== TEMP_USERNAME || password !== TEMP_PASSWORD) {
    res.status(401).json({ error: "IDまたはパスワードが違います" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`session:${token}`, username, { ex: SESSION_TTL_SECONDS });

  res.setHeader(
    "Set-Cookie",
    `process_rx_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax; Secure`
  );
  res.status(200).json({ status: "ok" });
}
