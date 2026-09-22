export const DRIVER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ドライバー名から色を決める。knownDrivers内の登録順で色を割り当て、
// 未登録の名前でもhashで安定した色になるようにする。
export function driverColor(name, knownDrivers) {
  if (!name || name === "未割当") return "#6b7280";
  const idx = (knownDrivers || []).findIndex((d) => d.name === name);
  const i = idx === -1 ? hashCode(name) : idx;
  return DRIVER_COLORS[i % DRIVER_COLORS.length];
}
