import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function mask(value) {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const [token, secret] = await Promise.all([
      redis.get("settings:line_channel_token"),
      redis.get("settings:line_channel_secret"),
    ]);
    res.status(200).json({
      token_set: !!token,
      token_masked: mask(token),
      secret_set: !!secret,
      secret_masked: mask(secret),
    });
    return;
  }

  if (req.method === "POST") {
    const { channel_access_token, channel_secret } = req.body || {};

    if (channel_access_token !== undefined) {
      if (channel_access_token) {
        await redis.set("settings:line_channel_token", channel_access_token);
      } else {
        await redis.del("settings:line_channel_token");
      }
    }

    if (channel_secret !== undefined) {
      if (channel_secret) {
        await redis.set("settings:line_channel_secret", channel_secret);
      } else {
        await redis.del("settings:line_channel_secret");
      }
    }

    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POSTのみ対応しています" });
}
