import { SESSION_TTL_SECONDS, parseCookies, sessionCookie, signStandaloneToken, verifyStandaloneToken } from "./_auth-utils.js";

// ログイン中の人の情報を返す。
//   kind: "master"(z/z) | "employee"(従業員) | "legacy"(旧形式)
//   role: "admin" | "staff"
export async function getSession(req) {
  return (await getSessionDetailed(req)).session;
}

// session: ログイン中の人(いなければnull)
// error  : 保存先(Upstash)の一時的な不調で、確かめられなかった(=ログアウトとは違う)
export async function getSessionDetailed(req) {
  const raw = parseCookies(req.headers.cookie).process_rx_session;
  if (!raw || !raw.includes(":")) return { session: null, error: false };
  const [kind, token] = raw.split(/:(.+)/);
  try {
    return { session: await resolveSession(kind, token), error: false };
  } catch (err) {
    console.error("session lookup failed (upstash unreachable?):", err);
    return { session: null, error: true };
  }
}

async function resolveSession(kind, token) {
  if (kind === "standalone") {
    const v = verifyStandaloneToken(token);
    return v ? { kind: "master", role: "admin", name: v.username, employee_id: null } : null;
  }

  if (kind === "redis") {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    let s = await redis.get(`session:${token}`);
    if (!s) return null;
    if (typeof s === "string") {
      try {
        s = JSON.parse(s);
      } catch {
        s = { name: s };
      }
    }
    if (s && s.type === "employee" && s.id) {
      // 権限変更・無効化をすぐ反映するため、毎回従業員データを見る
      const e = await redis.get(`employee:${s.id}`);
      if (!e) return null;
      const emp = typeof e === "string" ? JSON.parse(e) : e;
      if (!emp.active) return null;
      return {
        kind: "employee",
        role: emp.role,
        name: emp.name,
        employee_id: emp.id,
        is_driver: !!emp.is_driver,
      };
    }
    return { kind: "legacy", role: "admin", name: (s && s.name) || "user", employee_id: null };
  }
  return null;
}

// ログインの有効期間を延ばす(アプリを開くたびに呼ぶ=使っている間は切れない)。失敗しても、ログインはそのまま
export async function renewSession(req, res, session) {
  try {
    const raw = parseCookies(req.headers.cookie).process_rx_session || "";
    const [kind, token] = raw.split(/:(.+)/);
    if (kind === "standalone") {
      res.setHeader("Set-Cookie", sessionCookie(`standalone:${signStandaloneToken(session.name, SESSION_TTL_SECONDS)}`));
    } else if (kind === "redis") {
      const { Redis } = await import("@upstash/redis");
      await Redis.fromEnv().expire(`session:${token}`, SESSION_TTL_SECONDS);
      res.setHeader("Set-Cookie", sessionCookie(`redis:${token}`));
    }
  } catch (err) {
    console.error("session renew failed:", err);
  }
}

export function isAdmin(session) {
  return !!session && session.role === "admin";
}
