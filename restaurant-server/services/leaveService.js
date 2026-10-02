// services/leaveService.js
// ─────────────────────────────────────────────────────────────────────────────
// Staff leave. Waiters/chefs request it from their own app (source SELF,
// PENDING); the owner approves or declines it on the Employees page, or
// records leave directly (source ADMIN, APPROVED). Paid vs unpaid is decided
// on approval — unpaid days are deducted in services/payService.js.
// Every status change is ONE atomic conditional update on status: PENDING,
// never check-then-save.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 31;
const fail = (message, statusCode) => { const err = new Error(message); err.statusCode = statusCode; throw err; };

/** "YYYY-MM-DD" → local midnight Date (throws 400 on anything else). */
export const parseDay = (value, label = "date") => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) fail(`Enter a valid ${label}`, 400);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) fail(`Enter a valid ${label}`, 400);
  return date;
};

/** Inclusive day count between two local-midnight dates. */
export const daysBetween = (from, to) => Math.round((to - from) / DAY_MS) + 1;

export const validateRange = (fromStr, toStr, { allowPast = false } = {}) => {
  const from = parseDay(fromStr, "start date");
  const to = parseDay(toStr || fromStr, "end date");
  if (to < from) fail("End date can't be before the start date", 400);
  const days = daysBetween(from, to);
  if (days > MAX_DAYS) fail(`Leave can be at most ${MAX_DAYS} days at a time`, 400);
  if (!allowPast) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (from < today) fail("Leave can't start in the past", 400);
  }
  return { from, to, days };
};

const assertNoOverlap = async (StaffLeave, employeeId, from, to) => {
  const clash = await StaffLeave.findOne({
    employee: employeeId,
    status: { $in: ["PENDING", "APPROVED"] },
    from: { $lte: to },
    to: { $gte: from },
  });
  if (clash) fail("These dates overlap another leave request", 409);
};

/** Staff member asks for leave from their own app. */
export const requestLeave = async ({ StaffLeave, employee, from: fromStr, to: toStr, reason, actor }) => {
  const { from, to, days } = validateRange(fromStr, toStr);
  await assertNoOverlap(StaffLeave, employee._id, from, to);
  return StaffLeave.create({
    employee: employee._id, from, to, days,
    reason: String(reason || "").trim().slice(0, 300),
    status: "PENDING", source: "SELF", requestedBy: actor,
  });
};

/** Owner records leave directly (e.g. a phone call) — approved immediately. */
export const recordLeave = async ({ StaffLeave, employeeId, from: fromStr, to: toStr, reason, paid, actor }) => {
  const { from, to, days } = validateRange(fromStr, toStr, { allowPast: true });
  await assertNoOverlap(StaffLeave, employeeId, from, to);
  return StaffLeave.create({
    employee: employeeId, from, to, days,
    reason: String(reason || "").trim().slice(0, 300),
    status: "APPROVED", paid: !!paid, source: "ADMIN",
    requestedBy: actor, decidedBy: actor, decidedAt: new Date(),
  });
};

/** Owner approves (paid / unpaid) or declines a PENDING request — once. */
export const decideLeave = async ({ StaffLeave, leaveId, decision, paid, actor }) => {
  if (!["APPROVED", "DECLINED"].includes(decision)) fail("decision must be APPROVED or DECLINED", 400);
  const set = { status: decision, decidedBy: actor, decidedAt: new Date() };
  if (decision === "APPROVED") set.paid = !!paid;
  const updated = await StaffLeave.findOneAndUpdate({ _id: leaveId, status: "PENDING" }, { $set: set }, { new: true });
  if (updated) return updated;
  const exists = await StaffLeave.findById(leaveId);
  if (!exists) fail("Leave request not found", 404);
  fail(`This request was already ${exists.status.toLowerCase()}`, 409);
};

/** Staff withdraws their own still-pending request. */
export const cancelOwnLeave = async ({ StaffLeave, leaveId, employeeId }) => {
  const updated = await StaffLeave.findOneAndUpdate(
    { _id: leaveId, employee: employeeId, status: "PENDING" },
    { $set: { status: "CANCELLED" } },
    { new: true },
  );
  if (!updated) fail("Only your own pending requests can be withdrawn", 409);
  return updated;
};

/** Approved leave days that fall inside [monthStart, monthEnd], split paid/unpaid (pure). */
export const leaveDaysInRange = (leaves, monthStart, monthEnd) => {
  let paid = 0, unpaid = 0;
  for (const l of leaves) {
    if (l.status !== "APPROVED") continue;
    const from = new Date(Math.max(new Date(l.from), monthStart));
    const to = new Date(Math.min(new Date(l.to), monthEnd));
    if (to < from) continue;
    const n = daysBetween(new Date(from.setHours(0, 0, 0, 0)), new Date(to.setHours(0, 0, 0, 0)));
    if (l.paid) paid += n; else unpaid += n;
  }
  return { paid, unpaid };
};

export const listLeaves = ({ StaffLeave, employeeId }) =>
  StaffLeave.find({ employee: employeeId }).sort({ from: -1 }).limit(100).lean();
