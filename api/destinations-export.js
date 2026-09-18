import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

function csvEscape(field) {
  const str = String(field ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GETのみ対応しています" });
    return;
  }

  const ids = await redis.smembers("destinations:ids");
  const rawItems = ids.length
    ? await redis.mget(...ids.map((id) => `destination:${id}`))
    : [];
  const destinations = rawItems
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));

  const header = ["施設名", "氏名", "ヨミ", "住所", "備考"];
  const lines = [header.join(",")];
  for (const d of destinations) {
    lines.push(
      [d.facility_name, d.name, d.yomi, d.address, d.notes]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = "\uFEFF" + lines.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="destinations.csv"'
  );
  res.status(200).send(csv);
}
