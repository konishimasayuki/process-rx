import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { hashPassword } from "./_password.js";
import { listEmployees, getEmployee, publicEmployee } from "./_employees.js";

const redis = Redis.fromEnv();
const RESERVED_LOGIN_IDS = [process.env.LOGIN_USERNAME || "z"];
const ROLES = ["admin", "staff"];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

// 給与の設定(時給/月給・通勤手当)
function paySettings(src, base = {}) {
  const pick = (k, d) => (src[k] !== undefined ? src[k] : base[k] !== undefined ? base[k] : d);
  return {
    pay_type: ["hourly", "monthly"].includes(pick("pay_type", "hourly")) ? pick("pay_type", "hourly") : "hourly",
    hourly_wage: num(pick("hourly_wage", 0)),
    monthly_salary: num(pick("monthly_salary", 0)),
    standard_hours: num(pick("standard_hours", 160), 160) || 160,
    commute_type: ["none", "daily", "monthly"].includes(pick("commute_type", "none")) ? pick("commute_type", "none") : "none",
    commute_amount: num(pick("commute_amount", 0)),
  };
}

async function loginIdTaken(loginId, exceptId) {
  const owner = await redis.get(`employee_login:${loginId}`);
  return !!owner && owner !== exceptId;
}

function validate({ name, login_id, role }) {
  if (!name || !String(name).trim()) return "氏名は必須です";
  if (!login_id || !/^[A-Za-z0-9_.-]{2,32}$/.test(login_id))
    return "ログインIDは半角英数字(2〜32文字)で入力してください";
  if (RESERVED_LOGIN_IDS.includes(login_id)) return "このログインIDは使えません";
  if (role && !ROLES.includes(role)) return "権限が不正です";
  return null;
}

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });
  if (!isAdmin(session)) return res.status(403).json({ error: "管理者のみ操作できます" });

  if (req.method === "GET") {
    const employees = (await listEmployees(redis)).map(publicEmployee);
    res.status(200).json({ employees });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const { name, login_id, password, role } = body;
    const error = validate({ name, login_id, role });
    if (error) return res.status(400).json({ error });
    if (!password || String(password).length < 4)
      return res.status(400).json({ error: "パスワードは4文字以上にしてください" });
    if (await loginIdTaken(login_id)) return res.status(400).json({ error: "このログインIDはすでに使われています" });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      name: String(name).trim(),
      login_id,
      role: role || "staff",
      active: true,
      is_driver: !!body.is_driver,
      line_id: String(body.line_id || "").trim(),
      ...paySettings(body),
      password_hash: hashPassword(password),
      created_at: new Date().toISOString(),
    };
    await redis.set(`employee:${id}`, JSON.stringify(record));
    await redis.set(`employee_login:${login_id}`, id);
    await redis.sadd("employees:ids", id);
    res.status(200).json({ status: "ok", employee: publicEmployee(record) });
    return;
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const existing = body.id ? await getEmployee(redis, body.id) : null;
    if (!existing) return res.status(404).json({ error: "従業員が見つかりません" });

    const next = {
      ...existing,
      name: body.name !== undefined ? String(body.name).trim() : existing.name,
      login_id: body.login_id !== undefined ? body.login_id : existing.login_id,
      role: body.role !== undefined ? body.role : existing.role,
      active: body.active !== undefined ? !!body.active : existing.active,
      is_driver: body.is_driver !== undefined ? !!body.is_driver : !!existing.is_driver,
      line_id: body.line_id !== undefined ? String(body.line_id || "").trim() : existing.line_id || "",
      ...paySettings(body, existing),
      updated_at: new Date().toISOString(),
    };
    const error = validate(next);
    if (error) return res.status(400).json({ error });
    if (next.login_id !== existing.login_id && (await loginIdTaken(next.login_id, existing.id)))
      return res.status(400).json({ error: "このログインIDはすでに使われています" });
    if (body.password) {
      if (String(body.password).length < 4)
        return res.status(400).json({ error: "パスワードは4文字以上にしてください" });
      next.password_hash = hashPassword(body.password);
    }

    await redis.set(`employee:${existing.id}`, JSON.stringify(next));
    if (next.login_id !== existing.login_id) {
      await redis.del(`employee_login:${existing.login_id}`);
      await redis.set(`employee_login:${next.login_id}`, existing.id);
    }
    res.status(200).json({ status: "ok", employee: publicEmployee(next) });
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    const existing = id ? await getEmployee(redis, id) : null;
    if (!existing) return res.status(404).json({ error: "従業員が見つかりません" });
    await redis.del(`employee:${id}`);
    await redis.del(`employee_login:${existing.login_id}`);
    await redis.srem("employees:ids", id);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
