const JST = 9 * 3600 * 1000;
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const PUNCH_LABELS = { clock_in: "出勤", clock_out: "退勤", out: "途中出", back: "途中戻" };
export const STATE_LABELS = { off: "勤務外", working: "勤務中", out: "途中外出中" };

export function jstNow() {
  return new Date(Date.now() + JST);
}
export function jstToday() {
  return jstNow().toISOString().slice(0, 10);
}
export function jstMonth() {
  return jstToday().slice(0, 7);
}
export function hm(iso) {
  if (!iso) return "--:--";
  return new Date(new Date(iso).getTime() + JST).toISOString().slice(11, 16);
}
export function minToHM(min) {
  const m = Math.round(min || 0);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}
export function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}
export function daysOfMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
export function yen(n) {
  return `${Math.round(n || 0).toLocaleString("ja-JP")}円`;
}
