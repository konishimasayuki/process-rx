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

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function buildDayView(date, depotGeo) {
  const entries = await listEntriesForDate(date);

  const withDestinations = await Promise.all(
    entries.map(async (entry) => {
      const destination = await getDestination(entry.destination_id);
      return { ...entry, destination };
    })
  );

  const byDriver = {};
  for (const entry of withDestinations) {
    const driver = entry.driver || "未割当";
    if (!byDriver[driver]) byDriver[driver] = [];
    byDriver[driver].push(entry);
  }

  const drivers = Object.entries(byDriver).map(([driver, driverEntries]) => {
    const hasManualOrder = driverEntries.some((e) => e.manual_order != null);

    if (hasManualOrder) {
      const sorted = [...driverEntries].sort((a, b) => {
        const ao = a.manual_order ?? Infinity;
        const bo = b.manual_order ?? Infinity;
        return ao - bo;
      });
      const stops = sorted
        .filter((e) => e.destination)
        .map((e) => ({
          ...e.destination,
          entry_id: e.id,
          time_type: e.time_type,
          time_value: e.time_value,
        }));
      const mapsUrl = stops.length ? buildGoogleMapsRouteUrl(stops) : null;
      return { driver, stops, routable: true, manual: true, maps_url: mapsUrl };
    }

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

    return { driver, stops: ordered, routable, manual: false, maps_url: mapsUrl };
  });

  return { date, drivers };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { date, start_date, days } = req.query || {};
    const depotGeo = await getDepotGeo();

    if (start_date && days) {
      const numDays = Math.min(Number(days) || 7, 31);
      const dayViews = [];
      for (let i = 0; i < numDays; i++) {
        dayViews.push(await buildDayView(addDays(start_date, i), depotGeo));
      }
      res.status(200).json({ depot_address: DEPOT_ADDRESS, days: dayViews });
      return;
    }

    if (!date) {
      res
        .status(400)
        .json({ error: "dateか、start_date+daysのクエリパラメータが必要です" });
      return;
    }

    const dayView = await buildDayView(date, depotGeo);
    res
      .status(200)
      .json({ date, depot_address: DEPOT_ADDRESS, drivers: dayView.drivers });
    return;
  }

  if (req.method === "POST") {
    const { destination_id, date, driver, time_type, time_value } = req.body || {};
    const driverName = driver && driver.trim() ? driver.trim() : "";

    if (!destination_id || !date || !time_type) {
      res
        .status(400)
        .json({ error: "destination_id, date, time_typeは必須です" });
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
      driver: driverName,
      time_type,
      time_value: time_type === "FIXED" ? time_value : null,
      manual_order: null,
      created_at: new Date().toISOString(),
    };

    await redis.set(`board_entry:${id}`, JSON.stringify(record));
    await redis.sadd(`board:date:${date}`, id);
    if (driverName) {
      await redis.sadd("drivers:known", driverName);
    }

    res.status(200).json({ status: "ok", entry: record });
    return;
  }

  if (req.method === "PUT") {
    // ドラッグによる並び替え・日付/ドライバー変更。
    // new_index未指定の場合は末尾に追加する。
    const { id, new_date, new_driver, new_index } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "idは必須です" });
      return;
    }

    const raw = await redis.get(`board_entry:${id}`);
    if (!raw) {
      res.status(404).json({ error: "該当データが見つかりません" });
      return;
    }
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;

    const targetDate = new_date || entry.date;
    const targetDriver = new_driver !== undefined ? new_driver : entry.driver || "";
    const dateChanged = targetDate !== entry.date;

    const targetDateIds = await redis.smembers(`board:date:${targetDate}`);
    const targetDateKeys = targetDateIds.map((i) => `board_entry:${i}`);
    const targetDateRaw = targetDateKeys.length
      ? await redis.mget(...targetDateKeys)
      : [];
    const targetGroup = targetDateRaw
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
      .filter((e) => (e.driver || "") === targetDriver && e.id !== id);

    targetGroup.sort((a, b) => {
      const ao = a.manual_order ?? Infinity;
      const bo = b.manual_order ?? Infinity;
      if (ao !== bo) return ao - bo;
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

    const movedEntry = { ...entry, date: targetDate, driver: targetDriver };
    const insertIndex = Math.max(
      0,
      Math.min(new_index ?? targetGroup.length, targetGroup.length)
    );
    targetGroup.splice(insertIndex, 0, movedEntry);

    for (let i = 0; i < targetGroup.length; i++) {
      targetGroup[i].manual_order = i;
      await redis.set(
        `board_entry:${targetGroup[i].id}`,
        JSON.stringify(targetGroup[i])
      );
    }

    if (dateChanged) {
      await redis.srem(`board:date:${entry.date}`, id);
      await redis.sadd(`board:date:${targetDate}`, id);
    }
    if (targetDriver) {
      await redis.sadd("drivers:known", targetDriver);
    }

    res.status(200).json({ status: "ok" });
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

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
