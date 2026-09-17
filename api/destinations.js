import { Redis } from "@upstash/redis";
import { geocodeAddress } from "./_delivery-utils.js";

const redis = Redis.fromEnv();

async function listDestinations() {
  const ids = await redis.smembers("destinations:ids");
  if (ids.length === 0) return [];

  const keys = ids.map((id) => `destination:${id}`);
  const rawItems = await redis.mget(...keys);
  return rawItems
    .filter(Boolean)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const destinations = await listDestinations();
    res.status(200).json({ destinations });
    return;
  }

  if (req.method === "POST") {
    const { facility_name, name, address, notes } = req.body || {};

    if (!name || !address) {
      res.status(400).json({ error: "氏名と住所は必須です" });
      return;
    }

    const geo = await geocodeAddress(address);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      facility_name: facility_name || "",
      name,
      address,
      notes: notes || "",
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      created_at: new Date().toISOString(),
    };

    await redis.set(`destination:${id}`, JSON.stringify(record));
    await redis.sadd("destinations:ids", id);

    res.status(200).json({ status: "ok", destination: record });
    return;
  }

  if (req.method === "PUT") {
    const { id, facility_name, name, address, notes } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "idは必須です" });
      return;
    }

    const raw = await redis.get(`destination:${id}`);
    if (!raw) {
      res.status(404).json({ error: "該当データが見つかりません" });
      return;
    }

    const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
    const addressChanged = address && address !== existing.address;

    const updated = {
      ...existing,
      facility_name: facility_name ?? existing.facility_name,
      name: name ?? existing.name,
      address: address ?? existing.address,
      notes: notes ?? existing.notes,
      updated_at: new Date().toISOString(),
    };

    if (addressChanged) {
      const geo = await geocodeAddress(updated.address);
      updated.lat = geo?.lat ?? null;
      updated.lng = geo?.lng ?? null;
    }

    await redis.set(`destination:${id}`, JSON.stringify(updated));
    res.status(200).json({ status: "ok", destination: updated });
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "idは必須です" });
      return;
    }

    await redis.del(`destination:${id}`);
    await redis.srem("destinations:ids", id);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
