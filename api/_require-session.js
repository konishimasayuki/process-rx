import { getSession, isAdmin } from "./_session.js";

export { getSession, isAdmin };

// ログイン中かどうか
export async function hasValidSession(req) {
  return !!(await getSession(req));
}
