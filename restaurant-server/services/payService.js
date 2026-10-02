// services/payService.js
// ─────────────────────────────────────────────────────────────────────────────
// Monthly staff pay, worked out from real records only:
//   salary       User.hr.salary (₹/month, set by the owner)
//   overtime     per day: hours worked (closed AttendanceSessions) beyond
//                User.hr.shiftHours, summed, × User.hr.otRate (₹/hour)
//   unpaid leave APPROVED, unpaid StaffLeave days in the month × salary ÷ 30
//   advances     StaffPay ADVANCE rows for the month (repaid from this salary)
//   to pay       salary + overtime − unpaid leave − advances (never below 0)
// "Mark paid" writes one SALARY row with a snapshot of this breakdown; the
// partial unique index makes a second click (or a second admin) a 409.
// ─────────────────────────────────────────────────────────────────────────────
import { leaveDaysInRange } from "./leaveService.js";

const fail = (message, statusCode) => { const err = new Error(message); err.statusCode = statusCode; throw err; };
export const PAY_METHODS = ["Cash", "UPI", "Bank"];

/** "YYYY-MM" (default: this month) → { key, start, end } in local time. */
export const monthRange = (month) => {
  let y, m;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) fail("month must be YYYY-MM", 400);
    [y, m] = month.split("-").map(Number);
    if (m < 1 || m > 12) fail("month must be YYYY-MM", 400);
  } else {
    const now = new Date(); y = now.getFullYear(); m = now.getMonth() + 1;
  }
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { key: `${y}-${String(m).padStart(2, "0")}`, start, end };
};

/** Overtime seconds from closed sessions, grouped by the day each shift started (pure). */
export const overtimeSeconds = (sessions, shiftHours = 8) => {
  const byDay = new Map();
  for (const s of sessions) {
    if (s.status !== "CLOSED") continue; // an open shift isn't overtime yet
    const d = new Date(s.loginAt); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    byDay.set(k, (byDay.get(k) || 0) + (s.totalWorkingSeconds || 0));
  }
  const limit = shiftHours * 3600;
  let ot = 0;
  for (const secs of byDay.values()) ot += Math.max(0, secs - limit);
  return { otSeconds: ot, daysWorked: byDay.size, workedSeconds: [...byDay.values()].reduce((a, b) => a + b, 0) };
};

/** The month's pay breakdown (pure). */
export const computePay = ({ hr = {}, sessions = [], advances = [], unpaidLeaveDays = 0, paidLeaveDays = 0 }) => {
  const salary = Math.max(0, Number(hr.salary) || 0);
  const otRate = Math.max(0, Number(hr.otRate) || 0);
  const shiftHours = Number(hr.shiftHours) || 8;
  const { otSeconds, daysWorked, workedSeconds } = overtimeSeconds(sessions, shiftHours);
  const otHours = Math.round((otSeconds / 3600) * 10) / 10;
  const overtime = Math.round(otHours * otRate);
  const unpaidLeave = Math.round((salary / 30) * unpaidLeaveDays);
  const advance = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const gross = salary + overtime - unpaidLeave;
  return {
    salary, otRate, shiftHours, otHours, overtime,
    unpaidLeaveDays, paidLeaveDays, unpaidLeave,
    advance, gross, net: Math.max(0, gross - advance),
    daysWorked, hoursWorked: Math.round((workedSeconds / 3600) * 10) / 10,
  };
};

const loadMonth = async ({ AttendanceSession, StaffLeave, StaffPay, employeeId, start, end, key }) => {
  const [sessions, leaves, ledger] = await Promise.all([
    AttendanceSession.find({ employee: employeeId, loginAt: { $gte: start, $lte: end } }).lean(),
    StaffLeave.find({ employee: employeeId, status: "APPROVED", from: { $lte: end }, to: { $gte: start } }).lean(),
    StaffPay.find({ employee: employeeId, month: key }).sort({ createdAt: -1 }).lean(),
  ]);
  const { paid, unpaid } = leaveDaysInRange(leaves, start, end);
  const advances = ledger.filter((r) => r.type === "ADVANCE");
  const salaryRow = ledger.find((r) => r.type === "SALARY") || null;
  return { sessions, advances, salaryRow, paid, unpaid };
};

/** One person's pay for a month + the recent ledger. */
export const getEmployeePay = async ({ models, employee, month }) => {
  const { AttendanceSession, StaffLeave, StaffPay } = models;
  const { key, start, end } = monthRange(month);
  const m = await loadMonth({ AttendanceSession, StaffLeave, StaffPay, employeeId: employee._id, start, end, key });
  const breakdown = m.salaryRow?.breakdown || computePay({
    hr: employee.hr || {}, sessions: m.sessions, advances: m.advances, unpaidLeaveDays: m.unpaid, paidLeaveDays: m.paid,
  });
  const history = await StaffPay.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(24).lean();
  return { month: key, breakdown, advances: m.advances, salaryPaid: m.salaryRow, history };
};

export const recordAdvance = async ({ StaffPay, employeeId, month, amount, method, note, actor }) => {
  const { key } = monthRange(month);
  const value = Math.round(Number(amount));
  if (!Number.isFinite(value) || value <= 0) fail("Enter the advance amount", 400);
  if (method && !PAY_METHODS.includes(method)) fail(`method must be one of: ${PAY_METHODS.join(", ")}`, 400);
  const paid = await StaffPay.findOne({ employee: employeeId, month: key, type: "SALARY" });
  if (paid) fail("This month's salary is already paid — record the advance against next month", 409);
  return StaffPay.create({ employee: employeeId, month: key, type: "ADVANCE", amount: value, method: method || "Cash", note: String(note || "").trim().slice(0, 200), by: actor });
};

export const markSalaryPaid = async ({ models, employee, month, method, actor }) => {
  const { AttendanceSession, StaffLeave, StaffPay } = models;
  const { key, start, end } = monthRange(month);
  if (method && !PAY_METHODS.includes(method)) fail(`method must be one of: ${PAY_METHODS.join(", ")}`, 400);
  const m = await loadMonth({ AttendanceSession, StaffLeave, StaffPay, employeeId: employee._id, start, end, key });
  const breakdown = computePay({ hr: employee.hr || {}, sessions: m.sessions, advances: m.advances, unpaidLeaveDays: m.unpaid, paidLeaveDays: m.paid });
  try {
    return await StaffPay.create({ employee: employee._id, month: key, type: "SALARY", amount: breakdown.net, method: method || "Cash", breakdown, by: actor });
  } catch (err) {
    if (err?.code === 11000) fail("This month's salary is already marked paid", 409);
    throw err;
  }
};

/** Team strip: total still to pay this month and how many people it covers. */
export const teamPaySummary = async ({ models, employees, month }) => {
  const { AttendanceSession, StaffLeave, StaffPay } = models;
  const { key, start, end } = monthRange(month);
  let due = 0, unpaidPeople = 0, paidTotal = 0;
  const perEmployee = {};
  for (const emp of employees) {
    const m = await loadMonth({ AttendanceSession, StaffLeave, StaffPay, employeeId: emp._id, start, end, key });
    if (m.salaryRow) { paidTotal += m.salaryRow.amount; perEmployee[String(emp._id)] = { paid: true }; continue; }
    if (!(emp.hr?.salary > 0)) { perEmployee[String(emp._id)] = { paid: false, noSalary: true }; continue; }
    const b = computePay({ hr: emp.hr, sessions: m.sessions, advances: m.advances, unpaidLeaveDays: m.unpaid, paidLeaveDays: m.paid });
    due += b.net; unpaidPeople += 1;
    perEmployee[String(emp._id)] = { paid: false, net: b.net };
  }
  return { month: key, due, unpaidPeople, paidTotal, perEmployee };
};
