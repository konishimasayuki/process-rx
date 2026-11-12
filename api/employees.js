import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";
import { hashPassword } from "./_password.js";

const redis = Redis.fromEnv();
const RESERVED_LOGIN_IDS = [process.env.LOGIN_USERNAME || "z"];
const ROLES = ["admin", "staff"];

function publicView(e) {
  const { password_hash, ...rest } = e;
  return rest;
}

async function getEmployee(id) {
  const raw = await redis.get(`employee:${id}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
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
  if (!(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  if (req.method === "GET") {
    const ids = await redis.smembers("employees:ids");
    const raw = ids.length ? await redis.mget(...ids.map((id) => `employee:${id}`)) : [];
    const employees = raw
      .filter(Boolean)
      .map((r) => publicView(typeof r === "string" ? JSON.parse(r) : r))
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    res.status(200).json({ employees });
    return;
  }

  if (req.method === "POST") {
    const { name, login_id, password, role } = req.body || {};
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
      password_hash: hashPassword(password),
      created_at: new Date().toISOString(),
    };
    await redis.set(`employee:${id}`, JSON.stringify(record));
    await redis.set(`employee_login:${login_id}`, id);
    await redis.sadd("employees:ids", id);
    res.status(200).json({ status: "ok", employee: publicView(record) });
    return;
  }

  if (req.method === "PUT") {
    const { id, name, login_id, password, role, active } = req.body || {};
    const existing = id ? await getEmployee(id) : null;
    if (!existing) return res.status(404).json({ error: "従業員が見つかりません" });

    const next = {
      ...existing,
      name: name !== undefined ? String(name).trim() : existing.name,
      login_id: login_id !== undefined ? login_id : existing.login_id,
      role: role !== undefined ? role : existing.role,
      active: active !== undefined ? !!active : existing.active,
      updated_at: new Date().toISOString(),
    };
    const error = validate(next);
    if (error) return res.status(400).json({ error });
    if (next.login_id !== existing.login_id && (await loginIdTaken(next.login_id, id)))
      return res.status(400).json({ error: "このログインIDはすでに使われています" });
    if (password) {
      if (String(password).length < 4)
        return res.status(400).json({ error: "パスワードは4文字以上にしてください" });
      next.password_hash = hashPassword(password);
    }

    await redis.set(`employee:${id}`, JSON.stringify(next));
    if (next.login_id !== existing.login_id) {
      await redis.del(`employee_login:${existing.login_id}`);
      await redis.set(`employee_login:${next.login_id}`, id);
    }
    res.status(200).json({ status: "ok", employee: publicView(next) });
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    const existing = id ? await getEmployee(id) : null;
    if (!existing) return res.status(404).json({ error: "従業員が見つかりません" });
    await redis.del(`employee:${id}`);
    await redis.del(`employee_login:${existing.login_id}`);
    await redis.srem("employees:ids", id);
    res.status(200).json({ status: "ok" });
    return;
  }

  res.status(405).json({ error: "GET/POST/PUT/DELETEのみ対応しています" });
}
