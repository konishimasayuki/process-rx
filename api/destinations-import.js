import { Redis } from "@upstash/redis";
import { geocodeAddress } from "./_delivery-utils.js";

const redis = Redis.fromEnv();

function parseCsv(text) {
  const rows = [];
  let cur = [""];
  let inQuotes = false;
  let i = 0;

  const append = (c) => {
    cur[cur.length - 1] += c;
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      append(c);
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      cur.push("");
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      rows.push(cur);
      cur = [""];
      i++;
      continue;
    }
    append(c);
    i++;
  }

  if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POSTのみ対応しています" });
    return;
  }

  const { csv } = req.body || {};
  if (!csv) {
    res.status(400).json({ error: "csvは必須です" });
    return;
  }

  const cleaned = csv.replace(/^\uFEFF/, "");
  const rows = parseCsv(cleaned).filter(
    (r) => r.length > 1 || r[0].trim() !== ""
  );

  if (rows.length < 2) {
    res.status(400).json({ error: "データ行がありません" });
    return;
  }

  const header = rows[0].map((h) => h.trim());
  const idx = {
    facility_name: header.indexOf("施設名"),
    name: header.indexOf("氏名"),
    yomi: header.indexOf("ヨミ"),
    address: header.indexOf("住所"),
    notes: header.indexOf("備考"),
  };

  if (idx.name === -1 || idx.address === -1) {
    res
      .status(400)
      .json({ error: "ヘッダーに「氏名」「住所」の列が見つかりません" });
    return;
  }

  const existingIds = await redis.smembers("destinations:ids");
  const existingRaw = existingIds.length
    ? await redis.mget(...existingIds.map((id) => `destination:${id}`))
    : [];
  const existing = existingRaw
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  // 氏名で既存データと突き合わせる(差分インポート)
  const byName = new Map();
  for (const d of existing) {
    if (d.name && !byName.has(d.name)) byName.set(d.name, d);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[idx.name] || "").trim();
    const address = (row[idx.address] || "").trim();

    if (!name || !address) {
      skipped++;
      continue;
    }

    const facility_name =
      idx.facility_name !== -1 ? (row[idx.facility_name] || "").trim() : "";
    const yomi = idx.yomi !== -1 ? (row[idx.yomi] || "").trim() : "";
    const notes = idx.notes !== -1 ? (row[idx.notes] || "").trim() : "";

    const match = byName.get(name);

    if (match) {
      const addressChanged = address !== match.address;
      const record = {
        ...match,
        facility_name,
        yomi,
        address,
        notes,
        updated_at: new Date().toISOString(),
      };

      if (addressChanged) {
        const geo = await geocodeAddress(address);
        record.lat = geo?.lat ?? null;
        record.lng = geo?.lng ?? null;
      }

      await redis.set(`destination:${match.id}`, JSON.stringify(record));
      updated++;
    } else {
      const geo = await geocodeAddress(address);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${r}`;
      const record = {
        id,
        facility_name,
        name,
        yomi,
        address,
        notes,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        created_at: new Date().toISOString(),
      };

      await redis.set(`destination:${id}`, JSON.stringify(record));
      await redis.sadd("destinations:ids", id);
      created++;
    }
  }

  res.status(200).json({ status: "ok", created, updated, skipped });
}
