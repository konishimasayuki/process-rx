import { Redis } from "@upstash/redis";
import {
  DEPOT_ADDRESS,
  geocodeAddress,
  orderStopsByNearestNeighbor,
  buildGoogleMapsRouteUrl,
} from "./_delivery-utils.js";

const redis = Redis.fromEnv();
const UNASSIGNED_KEY = "board:unassigned";

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

async function listEntriesByIds(ids) {
  if (ids.length === 0) return [];
  const keys = ids.map((id) => `board_entry:${id}`);
  const rawItems = await redis.mget(...keys);
  return rawItems
    .filter(Boolean)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));
}

async function listEntriesForDate(date) {
  const ids = await redis.smembers(`board:date:${date}`);
  return listEntriesByIds(ids);
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

async function buildUnassignedView() {
  const ids = await redis.smembers(UNASSIGNED_KEY);
  const entries = await listEntriesByIds(ids);

  const withDestinations = await Promise.all(
    entries.map(async (entry) => {
      const destination = await getDestination(entry.destination_id);
      return { ...entry, destination };
    })
  );

  const items = withDestinations
    .filter((e) => e.destination)
    .map((e) => ({
      ...e.destination,
      entry_id: e.id,
      driver: e.driver,
      time_type: e.time_type,
      time_value: e.time_value,
      due_date: e.due_date || null,
    }));

  items.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });

  return items;
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
      const unassigned = await buildUnassignedView();
      res
        .status(200)
        .json({ depot_address: DEPOT_ADDRESS, days: dayViews, unassigned });
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
    const { destination_id, date, due_date, driver, time_type, time_value } =
      req.body || {};
    const driverName = driver && driver.trim() ? driver.trim() : "";

    if (!destination_id || !time_type) {
      res
        .status(400)
        .json({ error: "destination_id, time_typeは必須です" });
      return;
    }
    if (!date && !due_date) {
      res
        .status(400)
        .json({ error: "dateまたはdue_date(◯日まで)のいずれかが必須です" });
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
      date: date || null,
      due_date: date ? null : due_date,
      driver: driverName,
      time_type,
      time_value: time_type === "FIXED" ? time_value : null,
      manual_order: null,
      created_at: new Date().toISOString(),
    };

    await redis.set(`board_entry:${id}`, JSON.stringify(record));
    if (date) {
      await redis.sadd(`board:date:${date}`, id);
    } else {
      await redis.sadd(UNASSIGNED_KEY, id);
    }
    if (driverName) {
      await redis.sadd("drivers:known", driverName);
    }

    res.status(200).json({ status: "ok", entry: record });
    return;
  }

  if (req.method === "PUT") {
    // ドラッグ/手動操作による並び替え・日付移動、または単純な内容編集(時間帯・ドライバー名等)。
    // new_date === "unassigned" のとき未割り当てプールへ移動する。
    const {
      id,
      new_date,
      new_driver,
      new_index,
      time_type,
      time_value,
    } = req.body || {};
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

    const dateOrDriverChanged =
      (new_date !== undefined && new_date !== (entry.date ?? null) && !(new_date === "unassigned" && entry.date === null)) ||
      (new_driver !== undefined && new_driver !== (entry.driver || ""));
    const reorderRequested = new_index !== undefined;

    if (!dateOrDriverChanged && !reorderRequested) {
      // 日付・ドライバー・並び順は変えず、時間帯などの内容だけ更新する
      const updated = { ...entry };
      if (time_type !== undefined) {
        updated.time_type = time_type;
        updated.time_value = time_type === "FIXED" ? time_value : null;
      }
      await redis.set(`board_entry:${id}`, JSON.stringify(updated));
      res.status(200).json({ status: "ok" });
      return;
    }

    const sourceGroupKey = entry.date ? `board:date:${entry.date}` : UNASSIGNED_KEY;

    const targetIsUnassigned = new_date === "unassigned";
    const targetDate = targetIsUnassigned ? null : new_date || entry.date;
    const targetGroupKey = targetIsUnassigned
      ? UNASSIGNED_KEY
      : `board:date:${targetDate}`;
    const targetDriver = new_driver !== undefined ? new_driver : entry.driver || "";
    const groupChanged = targetGroupKey !== sourceGroupKey;

    if (targetIsUnassigned) {
      const movedEntry = {
        ...entry,
        date: null,
        driver: targetDriver,
        manual_order: null,
      };
      if (time_type !== undefined) {
        movedEntry.time_type = time_type;
        movedEntry.time_value = time_type === "FIXED" ? time_value : null;
      }
      await redis.set(`board_entry:${id}`, JSON.stringify(movedEntry));
      if (groupChanged) {
        await redis.srem(sourceGroupKey, id);
        await redis.sadd(UNASSIGNED_KEY, id);
      }
      res.status(200).json({ status: "ok" });
      return;
    }

    const targetIds = await redis.smembers(targetGroupKey);
    const targetRaw = await listEntriesByIds(targetIds);
    const targetGroup = targetRaw.filter(
      (e) => (e.driver || "") === targetDriver && e.id !== id
    );

    targetGroup.sort((a, b) => {
      const ao = a.manual_order ?? Infinity;
      const bo = b.manual_order ?? Infinity;
      if (ao !== bo) return ao - bo;
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

    const movedEntry = {
      ...entry,
      date: targetDate,
      due_date: null,
      driver: targetDriver,
    };
    if (time_type !== undefined) {
      movedEntry.time_type = time_type;
      movedEntry.time_value = time_type === "FIXED" ? time_value : null;
    }
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

    if (groupChanged) {
      await redis.srem(sourceGroupKey, id);
      await redis.sadd(targetGroupKey, id);
    }
    if (targetDriver) {
      await redis.sadd("drivers:known", targetDriver);
    }

    res.status(200).json({ status: "ok" });
    return;
  }

  if (req.method === "DELETE") {
    const { id, date } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "idは必須です" });
      return;
    }

    await redis.del(`board_entry:${id}`);
    if (date) {
      await redis.srem(`board:date:${date}`, id);
    }
    await redis.srem(UNASSIGNED_KEY, id);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
