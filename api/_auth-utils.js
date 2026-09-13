import crypto from "crypto";

// Upstashが落ちていてもz/zログインだけは維持するための、
// サーバー側の秘密鍵だけで検証できる署名付きトークン。
// SESSION_SECRET未設定時はビルド時の固定文字列にフォールバック(本番では必ず設定すること)。
const SESSION_SECRET = process.env.SESSION_SECRET || "process-rx-fallback-secret-change-me";

export function signStandaloneToken(username, ttlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${username}|${expiresAt}`;
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifyStandaloneToken(token) {
  if (!token || !token.includes(".")) return null;

  const [payloadB64, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature || "", "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const [username, expiresAtStr] = payload.split("|");
  const expiresAt = Number(expiresAtStr);

  if (!username || Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    return null;
  }

  return { username };
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...rest] = pair.trim().split("=");
    cookies[key] = rest.join("=");
  });
  return cookies;
}
