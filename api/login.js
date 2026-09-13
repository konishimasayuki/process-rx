import crypto from "crypto";
import { signStandaloneToken } from "./_auth-utils.js";

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12時間

// 仮運用の固定アカウント。Upstashが不通でもこのアカウントだけはログイン可能。
const STANDALONE_USERNAME = process.env.LOGIN_USERNAME || "z";
const STANDALONE_PASSWORD = process.env.LOGIN_PASSWORD || "z";

async function tryAdminLogin(username, password) {
  // 将来: Upstashに管理者テーブルを持たせてここで照合する。
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const stored = await redis.get(`admin_user:${username}`);
    if (!stored) return null;

    const storedRecord = typeof stored === "string" ? JSON.parse(stored) : stored;
    if (storedRecord.password !== password) return null;

    const token = crypto.randomBytes(32).toString("hex");
    await redis.set(`session:${token}`, username, { ex: SESSION_TTL_SECONDS });
    return token;
  } catch (err) {
    // Upstash不通時は管理者ログインは諦め、固定アカウントのみで続行
    console.error("admin login check failed (upstash unreachable?):", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: "IDとパスワードを入力してください" });
    return;
  }

  // 1. 固定アカウント(z/z)はUpstashを一切使わず即時発行
  if (username === STANDALONE_USERNAME && password === STANDALONE_PASSWORD) {
    const token = signStandaloneToken(username, SESSION_TTL_SECONDS);
    res.setHeader(
      "Set-Cookie",
      `process_rx_session=standalone:${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax; Secure`
    );
    res.status(200).json({ status: "ok" });
    return;
  }

  // 2. それ以外はUpstash管理者テーブルと照合(将来の複数管理者用)
  const redisToken = await tryAdminLogin(username, password);
  if (redisToken) {
    res.setHeader(
      "Set-Cookie",
      `process_rx_session=redis:${redisToken}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax; Secure`
    );
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(401).json({ error: "IDまたはパスワードが違います" });
}
