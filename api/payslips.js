import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";
import { getEmployee, listEmployees } from "./_employees.js";
import { jstDateOf, loadMonth } from "./_timecard-utils.js";

const redis = Redis.fromEnv();
const key = (employeeId, month) => `payslip:${employeeId}:${month}`;

const EARNING_ITEMS = [
  ["base", "基本給"],
  ["overtime", "残業手当"],
  ["night", "深夜手当"],
  ["commute", "通勤手当"],
  ["other", "その他手当"],
];
const DEDUCTION_ITEMS = [
  ["health", "健康保険"],
  ["pension", "厚生年金"],
  ["employment", "雇用保険"],
  ["income_tax", "所得税"],
  ["resident_tax", "住民税"],
  ["other", "その他控除"],
];

const yen = (n) => Math.round(Number(n) || 0);

// 勤怠と従業員の給与設定から、明細のたたき台を作る
function buildDraft(employee, month, totals) {
  const hours = totals.work_min / 60;
  const overtimeH = totals.overtime_min / 60;
  const nightH = totals.night_min / 60;
  const hourly =
    employee.pay_type === "monthly"
      ? (employee.monthly_salary || 0) / (employee.standard_hours || 160)
      : employee.hourly_wage || 0;

  const base =
    employee.pay_type === "monthly" ? employee.monthly_salary || 0 : hourly * (hours - overtimeH);
  const commute =
    employee.commute_type === "monthly"
      ? employee.commute_amount || 0
      : employee.commute_type === "daily"
        ? (employee.commute_amount || 0) * totals.days
        : 0;

  const amounts = {
    base: yen(base),
    overtime: yen(hourly * 1.25 * overtimeH),
    night: yen(hourly * 0.25 * nightH),
    commute: yen(commute),
    other: 0,
  };
  return {
    month,
    employee_id: employee.id,
    employee_name: employee.name,
    pay_type: employee.pay_type || "hourly",
    hourly_rate: Math.round(hourly),
    attendance: {
      days: totals.days,
      work_min: totals.work_min,
      overtime_min: totals.overtime_min,
      night_min: totals.night_min,
    },
    earnings: EARNING_ITEMS.map(([k, label]) => ({ key: k, label, amount: amounts[k] })),
    deductions: DEDUCTION_ITEMS.map(([k, label]) => ({ key: k, label, amount: 0 })),
    note: "",
    status: "draft",
  };
}

function withTotals(p) {
  const gross = p.earnings.reduce((s, e) => s + yen(e.amount), 0);
  const deduction = p.deductions.reduce((s, d) => s + yen(d.amount), 0);
  return { ...p, gross, deduction_total: deduction, net: gross - deduction };
}

async function getSaved(employeeId, month) {
  const raw = await redis.get(key(employeeId, month));
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

// 給料明細(管理者のみ)
//   GET ?month=           … その月の全従業員の状況
//   GET ?month=&employee_id= … 保存済みの明細と、勤怠からのたたき台
//   POST { employee_id, month, earnings, deductions, note, status } … 保存
export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "ログインが必要です" });
  if (!isAdmin(session)) return res.status(403).json({ error: "給料明細は管理者のみ見られます" });

  const q = req.query || {};
  const month = /^\d{4}-\d{2}$/.test(q.month || req.body?.month || "")
    ? q.month || req.body.month
    : jstDateOf(new Date()).slice(0, 7);

  if (req.method === "GET" && !q.employee_id) {
    const employees = (await listEmployees(redis)).filter((e) => e.active);
    const rows = await Promise.all(
      employees.map(async (e) => {
        const saved = await getSaved(e.id, month);
        const { totals } = await loadMonth(redis, e.id, month);
        return {
          employee_id: e.id,
          name: e.name,
          attendance: totals,
          status: saved ? saved.status : "none",
          net: saved ? saved.net : null,
        };
      })
    );
    res.status(200).json({ month, rows });
    return;
  }

  if (req.method === "GET") {
    const employee = await getEmployee(redis, q.employee_id);
    if (!employee) return res.status(404).json({ error: "従業員が見つかりません" });
    const { totals } = await loadMonth(redis, employee.id, month);
    res.status(200).json({
      saved: await getSaved(employee.id, month),
      draft: withTotals(buildDraft(employee, month, totals)),
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const employee = await getEmployee(redis, body.employee_id);
    if (!employee) return res.status(404).json({ error: "従業員が見つかりません" });
    const clean = (list, defs) =>
      defs.map(([k, label]) => {
        const found = (list || []).find((x) => x.key === k) || {};
        return { key: k, label: found.label || label, amount: yen(found.amount) };
      });
    const payslip = withTotals({
      month,
      employee_id: employee.id,
      employee_name: employee.name,
      pay_type: body.pay_type || employee.pay_type || "hourly",
      hourly_rate: yen(body.hourly_rate),
      attendance: body.attendance || {},
      earnings: clean(body.earnings, EARNING_ITEMS),
      deductions: clean(body.deductions, DEDUCTION_ITEMS),
      note: String(body.note || ""),
      status: body.status === "final" ? "final" : "draft",
      updated_at: new Date().toISOString(),
      updated_by: session.name,
    });
    await redis.set(key(employee.id, month), JSON.stringify(payslip));
    res.status(200).json({ status: "ok", payslip });
    return;
  }

  res.status(405).json({ error: "GET/POSTのみ対応しています" });
}
