import { getSession } from "./_session.js";

export default async function handler(req, res) {
  const s = await getSession(req);
  if (!s) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.status(200).json({
    authenticated: true,
    username: s.name,
    kind: s.kind,
    role: s.role,
    employee_id: s.employee_id,
    is_driver: !!s.is_driver,
  });
}
