import { Redis } from "@upstash/redis";
import { listEmployees } from "./_employees.js";
import { getSession, isAdmin } from "./_session.js";

const redis = Redis.fromEnv();

// ドライバー一覧 = 従業員一覧で「ドライバー」にチェックした人
// (以前の設定画面で登録したドライバーも、同じ名前の従業員がいなければ残す)
export default async function handler(req, res) {
  if (req.method === "GET") {
    const employees = (await listEmployees(redis)).filter((e) => e.active && e.is_driver);
    const names = new Set(employees.map((e) => e.name));
    const legacy = (await redis.smembers("drivers:known")).filter((n) => !names.has(n));
    const drivers = [
      ...employees.map((e) => ({ name: e.name, source: "employee" })),
      ...legacy.sort((a, b) => a.localeCompare(b, "ja")).map((n) => ({ name: n, source: "legacy" })),
    ];
    res.status(200).json({ drivers });
    return;
  }

  // 旧ドライバー登録の削除(管理者のみ)
  if (req.method === "DELETE") {
    const session = await getSession(req);
    if (!isAdmin(session)) return res.status(403).json({ error: "管理者のみ操作できます" });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "nameは必須です" });
    await redis.srem("drivers:known", name);
    await redis.del(`driver_info:${name}`);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/DELETEのみ対応しています" });
}
