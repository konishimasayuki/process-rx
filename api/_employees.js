// 従業員データの読み込み(他のAPIから使う共通処理)
export async function listEmployees(redis) {
  const ids = await redis.smembers("employees:ids");
  if (ids.length === 0) return [];
  const raw = await redis.mget(...ids.map((id) => `employee:${id}`));
  return raw
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

export async function getEmployee(redis, id) {
  const raw = await redis.get(`employee:${id}`);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

export function publicEmployee(e) {
  const { password_hash, ...rest } = e;
  return rest;
}
