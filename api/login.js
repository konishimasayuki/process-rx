import crypto from "crypto";
import { SESSION_TTL_SECONDS, sessionCookie, signStandaloneToken } from "./_auth-utils.js";
import { verifyPassword } from "./_password.js";

// 固定アカウント。Upstashが不通でもこのアカウントだけはログイン可能。
const STANDALONE_USERNAME = process.env.LOGIN_USERNAME || "z";
const STANDALONE_PASSWORD = process.env.LOGIN_PASSWORD || "z";

// 従業員一覧で登録したログインID/パスワードで照合する
async function tryEmployeeLogin(loginId, password) {
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const id = await redis.get(`employee_login:${loginId}`);
    if (!id) return null;
    const raw = await redis.get(`employee:${id}`);
    if (!raw) return null;
    const employee = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!employee.active) return null;
    if (!verifyPassword(password, employee.password_hash)) return null;

    const token = crypto.randomBytes(32).toString("hex");
    const session = { type: "employee", id: employee.id, name: employee.name, role: employee.role };
    await redis.set(`session:${token}`, JSON.stringify(session), { ex: SESSION_TTL_SECONDS });
    return token;
  } catch (err) {
    console.error("employee login check failed (upstash unreachable?):", err);
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
      sessionCookie(`standalone:${token}`)
    );
    res.status(200).json({ status: "ok" });
    return;
  }

  // 2. 従業員アカウント
  const redisToken = await tryEmployeeLogin(username, password);
  if (redisToken) {
    res.setHeader(
      "Set-Cookie",
      sessionCookie(`redis:${redisToken}`)
    );
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(401).json({ error: "IDまたはパスワードが違います" });
}
