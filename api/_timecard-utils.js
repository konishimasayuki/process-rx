const JST_OFFSET = 9 * 3600 * 1000;

export const PUNCH_LABELS = { clock_in: "出勤", clock_out: "退勤", out: "途中出", back: "途中戻" };

export function jstDateOf(date) {
  return new Date(new Date(date).getTime() + JST_OFFSET).toISOString().slice(0, 10);
}

export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 日本時間の「日付 + HH:MM」をISO文字列に
export function jstToIso(dateStr, hm) {
  const [h, m] = hm.split(":").map(Number);
  const base = Date.parse(`${dateStr}T00:00:00Z`) - JST_OFFSET;
  return new Date(base + (h * 60 + m) * 60000).toISOString();
}

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

// 2点間の距離(m)
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 今の状態で押せるボタン
export const ALLOWED = {
  off: ["clock_in"],
  working: ["out", "clock_out"],
  out: ["back", "clock_out"],
};

// 深夜(22:00〜翌5:00)と重なる分数
function nightMinutes(start, end) {
  let total = 0;
  let day = jstDateOf(new Date(start - 24 * 3600 * 1000));
  const lastDay = jstDateOf(end);
  while (day <= lastDay) {
    const ws = Date.parse(`${day}T22:00:00Z`) - JST_OFFSET;
    const we = ws + 7 * 3600 * 1000;
    const overlap = Math.min(end, we) - Math.max(start, ws);
    if (overlap > 0) total += overlap;
    day = shiftDate(day, 1);
  }
  return Math.round(total / 60000);
}

// 1日分の打刻から、実働・休憩(途中出〜戻)・残業(8時間超)・深夜を計算
export function summarize(events = []) {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  let state = "off";
  let segStart = null;
  let outAt = null;
  let breakMs = 0;
  const intervals = [];
  let firstIn = null;
  let lastOut = null;

  for (const ev of sorted) {
    const t = Date.parse(ev.at);
    if (ev.type === "clock_in" && state === "off") {
      state = "working";
      segStart = t;
      if (!firstIn) firstIn = ev.at;
    } else if (ev.type === "out" && state === "working") {
      intervals.push([segStart, t]);
      state = "out";
      outAt = t;
    } else if (ev.type === "back" && state === "out") {
      breakMs += t - outAt;
      state = "working";
      segStart = t;
    } else if (ev.type === "clock_out" && state !== "off") {
      if (state === "working") intervals.push([segStart, t]);
      state = "off";
      lastOut = ev.at;
    }
  }

  const workMin = Math.round(intervals.reduce((s, [a, b]) => s + (b - a), 0) / 60000);
  return {
    state,
    first_in: firstIn,
    last_out: lastOut,
    work_min: workMin,
    break_min: Math.round(breakMs / 60000),
    overtime_min: Math.max(0, workMin - 480),
    night_min: intervals.reduce((s, [a, b]) => s + nightMinutes(a, b), 0),
    has_reason: sorted.some((e) => e.reason),
  };
}

export function monthTotals(days) {
  return days.reduce(
    (acc, d) => {
      if (d.summary.first_in) acc.days += 1;
      acc.work_min += d.summary.work_min;
      acc.break_min += d.summary.break_min;
      acc.overtime_min += d.summary.overtime_min;
      acc.night_min += d.summary.night_min;
      return acc;
    },
    { days: 0, work_min: 0, break_min: 0, overtime_min: 0, night_min: 0 }
  );
}

// 1か月分の打刻(打刻のある日だけ)と合計
export async function loadMonth(redis, employeeId, month) {
  const dates = daysInMonth(month);
  const raw = await redis.mget(...dates.map((d) => `timecard:${employeeId}:${d}`));
  const days = raw
    .map((r, i) => (r ? (typeof r === "string" ? JSON.parse(r) : r) : { date: dates[i], events: [] }))
    .filter((d) => d.events.length > 0)
    .map((d) => ({ ...d, summary: summarize(d.events) }));
  return { days, totals: monthTotals(days) };
}
