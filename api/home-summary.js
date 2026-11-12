import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { listEmployees } from "./_employees.js";
import { jstDateOf, shiftDate, summarize } from "./_timecard-utils.js";

const redis = Redis.fromEnv();

async function todayState(employeeId, today) {
  const keys = [`timecard:${employeeId}:${today}`, `timecard:${employeeId}:${shiftDate(today, -1)}`];
  const [t, y] = (await redis.mget(...keys)).map((r) => (r ? (typeof r === "string" ? JSON.parse(r) : r) : null));
  if (t && t.events.length) return { ...summarize(t.events), date: today };
  if (y && y.events.length) {
    const ys = summarize(y.events);
    if (ys.state !== "off") return { ...ys, date: shiftDate(today, -1) };
  }
  return { state: "off", first_in: null, date: today };
}

// ホーム画面用のまとめ(本日のFAX・配達・自分の勤怠)
export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });

  const today = jstDateOf(new Date());

  const faxIds = await redis.lrange(`fax:date:${today}`, 0, -1);
  const faxItems = faxIds.length
    ? (await redis.mget(...faxIds.map((id) => `fax:item:${id}`)))
        .filter(Boolean)
        .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
    : [];
  const prescriptions = faxItems.filter((i) => i.is_prescription);

  const [deliveriesToday, unassigned] = await Promise.all([
    redis.scard(`board:date:${today}`),
    redis.scard("board:unassigned"),
  ]);

  const result = {
    today,
    fax: {
      faxes: new Set(faxItems.map((i) => i.fax_id || i.filename)).size,
      patients: prescriptions.length,
      unprinted: prescriptions.filter((i) => !i.printed_at).length,
      needs_review: prescriptions.filter((i) => i.needs_review).length,
    },
    delivery: { today: deliveriesToday || 0, unassigned: unassigned || 0 },
    me: session.employee_id ? await todayState(session.employee_id, today) : null,
  };

  if (isAdmin(session)) {
    const employees = (await listEmployees(redis)).filter((e) => e.active);
    const states = await Promise.all(employees.map((e) => todayState(e.id, today)));
    result.staff = employees.map((e, i) => ({
      name: e.name,
      state: states[i].state,
      first_in: states[i].first_in,
    }));
  }

  res.status(200).json(result);
}
