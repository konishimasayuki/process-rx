import { describeAiError } from "./_fax-ai.js";

const KEY = "ai:status";
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// AIの呼び出しが成功した/失敗したことを覚えておく(画面の警告表示用)
export async function recordAiStatus(redis, err) {
  try {
    if (!err) {
      const prev = parse(await redis.get(KEY));
      if (!prev || prev.ok === false) await redis.set(KEY, JSON.stringify({ ok: true, at: new Date().toISOString() }));
      return;
    }
    const d = describeAiError(err);
    await redis.set(KEY, JSON.stringify({ ok: false, code: d.code, message: d.message, at: new Date().toISOString() }));
  } catch {
    // 記録できなくても、取込は続ける
  }
}

export async function getAiStatus(redis) {
  return parse(await redis.get(KEY)) || { ok: true };
}
