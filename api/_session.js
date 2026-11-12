import { parseCookies, verifyStandaloneToken } from "./_auth-utils.js";

// ログイン中の人の情報を返す。
//   kind: "master"(z/z) | "employee"(従業員) | "legacy"(旧形式)
//   role: "admin" | "staff"
export async function getSession(req) {
  const raw = parseCookies(req.headers.cookie).process_rx_session;
  if (!raw || !raw.includes(":")) return null;
  const [kind, token] = raw.split(/:(.+)/);

  if (kind === "standalone") {
    const v = verifyStandaloneToken(token);
    return v ? { kind: "master", role: "admin", name: v.username, employee_id: null } : null;
  }

  if (kind === "redis") {
    try {
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
    } catch {
      return null;
    }
  }
  return null;
}

export function isAdmin(session) {
  return !!session && session.role === "admin";
}
