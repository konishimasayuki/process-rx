import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function timeLabel(stop) {
  if (stop.time_type === "FIXED") return stop.time_value;
  if (stop.time_type === "AM") return "AM";
  if (stop.time_type === "PM") return "PM";
  return "いつでも";
}

function buildMessage(date, stops, mapsUrl) {
  const lines = [`【${date} 配達ルート】`];
  stops.forEach((stop, idx) => {
    const facility = stop.facility_name ? `${stop.facility_name} ` : "";
    lines.push(
      `${idx + 1}. ${facility}${stop.name}様 (${timeLabel(stop)})\n${stop.address}`
    );
  });
  if (mapsUrl) {
    lines.push("");
    lines.push("経路: " + mapsUrl);
  }
  return lines.join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const { driver, date, stops, maps_url } = req.body || {};

  if (!driver || !date || !Array.isArray(stops) || stops.length === 0) {
    res.status(400).json({ error: "driver, date, stopsは必須です" });
    return;
  }

  const token = await redis.get("settings:line_channel_token");
  if (!token) {
    res
      .status(400)
      .json({ error: "LINEチャネルアクセストークンが設定されていません" });
    return;
  }

  const driverInfoRaw = await redis.get(`driver_info:${driver}`);
  const driverInfo = driverInfoRaw
    ? typeof driverInfoRaw === "string"
      ? JSON.parse(driverInfoRaw)
      : driverInfoRaw
    : null;

  if (!driverInfo?.line_id) {
    res
      .status(400)
      .json({ error: `${driver}さんのLINE IDが登録されていません` });
    return;
  }

  const text = buildMessage(date, stops, maps_url);

  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: driverInfo.line_id,
      messages: [{ type: "text", text }],
    }),
  });

  if (!lineRes.ok) {
    const errText = await lineRes.text();
    res.status(502).json({ error: "LINE送信に失敗しました", detail: errText });
    return;
  }

  res.status(200).json({ status: "ok" });
}
