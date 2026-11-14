import { getSessionDetailed, renewSession } from "./_session.js";

// アプリを開いたときのログイン確認。
//   200 … ログイン中(このとき、ログインの有効期間も延ばす)
//   401 … ログインしていない(期限切れ・無効化)
//   503 … 保存先(Upstash)の一時的な不調。ログアウトではないので、画面側は再確認する
export default async function handler(req, res) {
  const { session: s, error } = await getSessionDetailed(req);
  if (error) {
    res.status(503).json({ authenticated: false, error: "temporary" });
    return;
  }
  if (!s) {
    res.status(401).json({ authenticated: false });
    return;
  }
  await renewSession(req, res, s);
  res.status(200).json({
    authenticated: true,
    username: s.name,
    kind: s.kind,
    role: s.role,
    employee_id: s.employee_id,
    is_driver: !!s.is_driver,
  });
}
