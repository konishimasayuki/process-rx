import { Redis } from "@upstash/redis";
import {
  DEPOT_ADDRESS,
  geocodeAddress,
  orderStopsByNearestNeighbor,
  buildGoogleMapsRouteUrl,
} from "./_delivery-utils.js";

const redis = Redis.fromEnv();

let cachedDepotGeo = null;
async function getDepotGeo() {
  if (cachedDepotGeo !== null) return cachedDepotGeo;
  cachedDepotGeo = await geocodeAddress(DEPOT_ADDRESS);
  return cachedDepotGeo;
}

async function getDestination(destinationId) {
  const raw = await redis.get(`destination:${destinationId}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function listEntriesForDate(date) {
  const ids = await redis.smembers(`board:date:${date}`);
  if (ids.length === 0) return [];

  const keys = ids.map((id) => `board_entry:${id}`);
  const rawItems = await redis.mget(...keys);
  return rawItems
    .filter(Boolean)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { date } = req.query || {};
    if (!date) {
      res.status(400).json({ error: "dateクエリパラメータが必要です(YYYY-MM-DD)" });
      return;
    }

    const entries = await listEntriesForDate(date);

    // 配達先情報を結合
    const withDestinations = await Promise.all(
      entries.map(async (entry) => {
        const destination = await getDestination(entry.destination_id);
        return { ...entry, destination };
      })
    );

    // ドライバーごとにグループ化して、それぞれ最近傍法で並び替え
    const byDriver = {};
    for (const entry of withDestinations) {
      const driver = entry.driver || "未割当";
      if (!byDriver[driver]) byDriver[driver] = [];
      byDriver[driver].push(entry);
    }

    const depotGeo = await getDepotGeo();

    const drivers = Object.entries(byDriver).map(([driver, driverEntries]) => {
      const stops = driverEntries
        .filter((e) => e.destination)
        .map((e) => ({
          ...e.destination,
          entry_id: e.id,
          time_type: e.time_type,
          time_value: e.time_value,
        }));

      const { ordered, routable } = orderStopsByNearestNeighbor(depotGeo, stops);
      const mapsUrl = routable ? buildGoogleMapsRouteUrl(ordered) : null;

      return {
        driver,
        stops: ordered,
        routable,
        maps_url: mapsUrl,
      };
    });

    res.status(200).json({ date, depot_address: DEPOT_ADDRESS, drivers });
    return;
  }

  if (req.method === "POST") {
    const { destination_id, date, driver, time_type, time_value } = req.body || {};

    if (!destination_id || !date || !driver || !time_type) {
      res
        .status(400)
        .json({ error: "destination_id, date, driver, time_typeは必須です" });
      return;
    }

    if (!["FIXED", "AM", "PM", "ALL"].includes(time_type)) {
      res.status(400).json({ error: "time_typeはFIXED/AM/PM/ALLのいずれかです" });
      return;
    }

    if (time_type === "FIXED" && !time_value) {
      res.status(400).json({ error: "FIXEDの場合はtime_value(例: 14:00)が必須です" });
      return;
    }

    const destination = await getDestination(destination_id);
    if (!destination) {
      res.status(404).json({ error: "配達先が見つかりません" });
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      destination_id,
      date,
      driver,
      time_type,
      time_value: time_type === "FIXED" ? time_value : null,
      created_at: new Date().toISOString(),
    };

    await redis.set(`board_entry:${id}`, JSON.stringify(record));
    await redis.sadd(`board:date:${date}`, id);
    await redis.sadd("drivers:known", driver);

    res.status(200).json({ status: "ok", entry: record });
    return;
  }

  if (req.method === "DELETE") {
    const { id, date } = req.body || {};
    if (!id || !date) {
      res.status(400).json({ error: "idとdateは必須です" });
      return;
    }

    await redis.del(`board_entry:${id}`);
    await redis.srem(`board:date:${date}`, id);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/DELETEのみ対応しています" });
}
