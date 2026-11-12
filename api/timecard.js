import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { getEmployee } from "./_employees.js";
import { getCompany } from "./_company.js";
import {
  ALLOWED,
  PUNCH_LABELS,
  distanceM,
  jstDateOf,
  jstToIso,
  loadMonth,
  shiftDate,
  summarize,
} from "./_timecard-utils.js";

const redis = Redis.fromEnv();
const key = (employeeId, date) => `timecard:${employeeId}:${date}`;

async function getDay(employeeId, date) {
  const raw = await redis.get(key(employeeId, date));
  const day = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  return day || { date, events: [] };
}

// いま続いている勤務の日付と状態(日付をまたぐ夜勤にも対応)
async function currentShift(employeeId) {
  const today = jstDateOf(new Date());
  const yesterday = shiftDate(today, -1);
  const [t, y] = await Promise.all([getDay(employeeId, today), getDay(employeeId, yesterday)]);
  const ts = summarize(t.events);
  if (t.events.length === 0) {
    const ys = summarize(y.events);
    if (ys.state !== "off") return { date: yesterday, day: y, state: ys.state };
  }
  return { date: today, day: t, state: ts.state };
}

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });

  // ---- 月の勤怠を見る ----
  if (req.method === "GET") {
    const q = req.query || {};
    const targetId = q.employee_id && isAdmin(session) ? q.employee_id : session.employee_id;
    if (!targetId) return res.status(400).json({ error: "従業員を選んでください" });
    const month = /^\d{4}-\d{2}$/.test(q.month || "") ? q.month : jstDateOf(new Date()).slice(0, 7);
    const employee = await getEmployee(redis, targetId);
    if (!employee) return res.status(404).json({ error: "従業員が見つかりません" });

    const { days, totals } = await loadMonth(redis, targetId, month);
    const current = await currentShift(targetId);
    res.status(200).json({
      month,
      employee: { id: employee.id, name: employee.name },
      days,
      totals,
      current: { state: current.state, date: current.date, allowed: ALLOWED[current.state] },
    });
    return;
  }

  // ---- 打刻(本人のみ) ----
  if (req.method === "POST") {
    if (!session.employee_id)
      return res.status(400).json({ error: "従業員としてログインしたときだけ打刻できます" });
    const { type, lat, lng, accuracy, reason } = req.body || {};
    if (!PUNCH_LABELS[type]) return res.status(400).json({ error: "打刻の種類が不正です" });

    const shift = await currentShift(session.employee_id);
    const date = type === "clock_in" ? jstDateOf(new Date()) : shift.date;
    if (!ALLOWED[shift.state].includes(type)) {
      const stateLabel = { off: "勤務していない", working: "勤務中", out: "途中外出中" }[shift.state];
      return res.status(409).json({ error: `今は${stateLabel}のため「${PUNCH_LABELS[type]}」は押せません` });
    }

    const event = { type, at: new Date().toISOString(), reason: reason ? String(reason).trim() : null };
    const hasLocation = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    if (hasLocation) {
      event.lat = Number(lat);
      event.lng = Number(lng);
      event.accuracy = Number(accuracy) || null;
    }

    // 出勤・退勤は会社から決めた範囲内か確認。外なら理由が必要
    if (type === "clock_in" || type === "clock_out") {
      const company = await getCompany(redis);
      let distance = null;
      if (hasLocation && company.lat != null) {
        distance = Math.round(distanceM({ lat: event.lat, lng: event.lng }, company));
      }
      const tolerance = Math.min(Number(accuracy) || 0, 30);
      const within = distance != null && distance - tolerance <= company.radius_m;
      event.distance_m = distance;
      event.within = within;
      if (!within && !event.reason) {
        return res.status(409).json({
          need_reason: true,
          distance_m: distance,
          radius_m: company.radius_m,
          error:
            distance == null
              ? "位置情報が取れませんでした。理由を入力してください"
              : `会社から約${distance}m離れています。理由を入力してください`,
        });
      }
    }

    const day = type === "clock_in" ? await getDay(session.employee_id, date) : shift.day;
    day.events = [...day.events, event];
    await redis.set(key(session.employee_id, date), JSON.stringify(day));
    const summary = summarize(day.events);
    res.status(200).json({ status: "ok", event, date, state: summary.state, allowed: ALLOWED[summary.state] });
    return;
  }

  // ---- 管理者による修正(1日分をまとめて置き換え) ----
  if (req.method === "PUT") {
    if (!isAdmin(session)) return res.status(403).json({ error: "管理者のみ修正できます" });
    const { employee_id, date, events } = req.body || {};
    if (!employee_id || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Array.isArray(events))
      return res.status(400).json({ error: "入力が不正です" });

    let prev = null;
    const converted = [];
    for (const ev of events) {
      if (!PUNCH_LABELS[ev.type] || !/^\d{1,2}:\d{2}$/.test(ev.time || ""))
        return res.status(400).json({ error: "時刻は HH:MM で入力してください" });
      let at = jstToIso(date, ev.time);
      // 前の打刻より早い時刻は翌日(夜勤)とみなす
      if (prev && at < prev) at = jstToIso(shiftDate(date, 1), ev.time);
      prev = at;
      converted.push({ type: ev.type, at, reason: ev.reason ? String(ev.reason).trim() : null, edited: true });
    }

    if (converted.length === 0) {
      await redis.del(key(employee_id, date));
    } else {
      await redis.set(
        key(employee_id, date),
        JSON.stringify({ date, events: converted, edited_by: session.name, edited_at: new Date().toISOString() })
      );
    }
    res.status(200).json({ status: "ok", day: { date, events: converted, summary: summarize(converted) } });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUTのみ対応しています" });
}
