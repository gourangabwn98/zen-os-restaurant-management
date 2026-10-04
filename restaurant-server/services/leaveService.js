// services/leaveService.js
// ─────────────────────────────────────────────────────────────────────────────
// Staff leave. Waiters/chefs request it from their own app (source SELF,
// PENDING); the owner approves or declines it on the Employees page, or
// records leave directly (source ADMIN, APPROVED).
//
// EMP-02 — pay keys off APPROVAL, never off the remaining balance:
//   APPROVED                      → paid, even beyond the carried-forward balance
//   DECLINED, or PENDING on a day
//   that has already passed       → absconding: LOP (loss of pay) for those days
// Each employee earns RestaurantProfile.staffPolicy.paidLeavePerMonth (4) per
// month; unused leave carries forward as a running balance with no cap
// (leaveBalance). Unpaid days are deducted in services/payService.js.
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
    status: "APPROVED", paid: true, source: "ADMIN", // EMP-02: approved ⇒ paid
    requestedBy: actor, decidedBy: actor, decidedAt: new Date(),
  });
};

/** Owner approves (paid / unpaid) or declines a PENDING request — once. */
export const decideLeave = async ({ StaffLeave, leaveId, decision, paid, actor }) => {
  if (!["APPROVED", "DECLINED"].includes(decision)) fail("decision must be APPROVED or DECLINED", 400);
  const set = { status: decision, decidedBy: actor, decidedAt: new Date() };
  set.paid = decision === "APPROVED"; // EMP-02: pay follows approval, not a separate pick
  void paid;
  const updated = await StaffLeave.findOneAndUpdate({ _id: leaveId, status: "PENDING" }, { $set: set }, { returnDocument: "after" });
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
    { returnDocument: "after" },
  );
  if (!updated) fail("Only your own pending requests can be withdrawn", 409);
  return updated;
};

/**
 * Leave days inside [monthStart, monthEnd] (pure), EMP-02 rule:
 *   paid   = APPROVED days (always paid, whatever the balance)
 *   unpaid = LOP: DECLINED days, plus PENDING days that are already past
 *            (absent without approval) — they turn paid if approved later.
 */
export const leaveDaysInRange = (leaves, monthStart, monthEnd, now = new Date()) => {
  let paid = 0, unpaid = 0;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (const l of leaves) {
    if (!["APPROVED", "DECLINED", "PENDING"].includes(l.status)) continue;
    const from = new Date(Math.max(new Date(l.from), monthStart));
    let to = new Date(Math.min(new Date(l.to), monthEnd));
    if (l.status === "PENDING") to = new Date(Math.min(to, today.getTime() - 1)); // only days already gone
    if (to < from) continue;
    const n = daysBetween(new Date(from.setHours(0, 0, 0, 0)), new Date(to.setHours(0, 0, 0, 0)));
    if (l.status === "APPROVED") paid += n; else unpaid += n;
  }
  return { paid, unpaid };
};

/** Whole months from `start`'s month through `now`'s month, inclusive. */
const monthsInclusive = (start, now) =>
  Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1);

/**
 * EMP-02 running balance (pure): perMonth × months since joining (carried
 * forward, never reset, no cap) − approved leave days taken. May go
 * negative: approved leave beyond the balance is still paid.
 */
export const leaveBalance = ({ joinedAt, createdAt, perMonth = 4, leaves = [], now = new Date() }) => {
  const start = new Date(joinedAt || createdAt || now);
  const months = monthsInclusive(start, now);
  const earned = months * Math.max(0, Number(perMonth) || 0);
  const taken = leaves.filter((l) => l.status === "APPROVED").reduce((s, l) => s + (Number(l.days) || 0), 0);
  return { perMonth, months, earned, taken, balance: earned - taken };
};

export const listLeaves = ({ StaffLeave, employeeId }) =>
  StaffLeave.find({ employee: employeeId }).sort({ from: -1 }).limit(100).lean();
