import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = Redis.fromEnv();

// LINEの署名検証には生のリクエストボディが必要なため、自動パースを無効化する
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const MAX_HISTORY = 200;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("ok"); // LINEの検証アクセス(GET等)にも200を返す
    return;
  }

  const rawBody = await getRawBody(req);

  const channelSecret = await redis.get("settings:line_channel_secret");
  const signature = req.headers["x-line-signature"];

  if (channelSecret) {
    const expected = crypto
      .createHmac("sha256", channelSecret)
      .update(rawBody)
      .digest("base64");
    if (expected !== signature) {
      res.status(401).send("invalid signature");
      return;
    }
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).send("invalid body");
    return;
  }

  const events = body.events || [];

  for (const event of events) {
    if (event.type === "follow" && event.source?.userId) {
      const entry = {
        line_user_id: event.source.userId,
        added_at: new Date(event.timestamp || Date.now()).toISOString(),
      };
      await redis.lpush("line:friend_history", JSON.stringify(entry));
      await redis.ltrim("line:friend_history", 0, MAX_HISTORY - 1);
    }
  }

  res.status(200).send("ok");
}
