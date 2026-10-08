// services/employeeService.js
// ─────────────────────────────────────────────────────────────────────────────
// "Employee" = a User document with role in EMPLOYEE_ROLES. This is
// deliberately the SAME model that already handles admin/waiter login and
// auth — not a second, disconnected directory (that's what the old `Chef`
// model was, and why it couldn't log in as itself). Only an admin can create
// one; there is no public employee signup anywhere in this system.
// ─────────────────────────────────────────────────────────────────────────────

import { revenueOrderMatch } from "./insightsService.js";
import { zonedInstant } from "./offerStatsService.js";

// "staff" = EMP-03's "Other": a custom job (jobTitle) with no app login.
// "manager" = admin-app login limited to some pages (utils/roles.js).
export const EMPLOYEE_ROLES = ["manager", "waiter", "chef", "staff"]; // extensible — add new categories here only

/** The employee categories this person may see and manage: everything for
 *  an admin; a manager never another manager (middleware/managerScope.js). */
export const employeeRolesFor = (user) =>
  (!user?.isAdmin && user?.role === "manager" ? EMPLOYEE_ROLES.filter((r) => r !== "manager") : EMPLOYEE_ROLES);

/** EMP-03: a custom role name — trimmed, single-spaced, Title-ish as typed. */
export const cleanJobTitle = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers, matching the OTP flow already in place

export const validateEmployeeInput = ({ name, phone, role, jobTitle, roles = EMPLOYEE_ROLES }) => {
  if (!name || !name.trim()) {
    const err = new Error("Employee name is required"); err.statusCode = 400; throw err;
  }
  if (!phone || !PHONE_RE.test(String(phone).trim())) {
    const err = new Error("Enter a valid 10-digit phone number"); err.statusCode = 400; throw err;
  }
  if (!roles.includes(role)) {
    const err = new Error(`Category must be one of: ${roles.join(", ")}`); err.statusCode = 400; throw err;
  }
  if (role === "staff" && !cleanJobTitle(jobTitle)) {
    const err = new Error("Type the role for \"Other\" (e.g. Cashier, Helper)"); err.statusCode = 400; throw err;
  }
};

export const createEmployee = async ({ User, name, phone, address, role, jobTitle, roles = EMPLOYEE_ROLES }) => {
  validateEmployeeInput({ name, phone, role, jobTitle, roles });
  const cleanPhone = String(phone).trim();

  // Uniqueness among ACTIVE accounts only — a deactivated ex-employee's old
  // phone number can be reassigned to someone new without a DB cleanup step.
  const existingActive = await User.findOne({ phone: cleanPhone, status: { $ne: "Inactive" } });
  if (existingActive) {
    const err = new Error("An active account with this phone number already exists");
    err.statusCode = 409;
    throw err;
  }

  return User.create({
    name: name.trim(),
    phone: cleanPhone,
    address: address?.trim() || "",
    role,
    jobTitle: role === "staff" ? cleanJobTitle(jobTitle) : "",
    isAdmin: false,
    status: "Active",
    isVerified: false, // becomes true the first time they successfully log in via OTP
  });
};

// ── HR fields (Pay / Documents) — whitelist + validation ────────────────────
export const ID_PROOF_TYPES = ["Aadhaar", "PAN", "Voter ID", "Driving licence", "Passport"];
const hrFail = (msg) => { const err = new Error(msg); err.statusCode = 400; throw err; };

/** Returns only the allowed, validated hr.* keys present in `input` (pure). */
export const cleanHrInput = (input = {}) => {
  const out = {};
  const num = (key, label, { min = 0, max = 10000000 } = {}) => {
    if (input[key] === undefined) return;
    const v = Number(input[key]);
    if (!Number.isFinite(v) || v < min || v > max) hrFail(`${label} must be between ${min} and ${max}`);
    out[key] = Math.round(v * 100) / 100;
  };
  const str = (key, max = 120) => { if (input[key] !== undefined) out[key] = String(input[key] ?? "").trim().slice(0, max); };
  num("salary", "Monthly salary");
  num("otRate", "Overtime rate", { max: 10000 });
  num("shiftHours", "Shift hours", { min: 1, max: 16 });
  if (input.joinedAt !== undefined) {
    if (!input.joinedAt) out.joinedAt = null;
    else {
      const d = new Date(input.joinedAt);
      if (Number.isNaN(d.getTime()) || d > new Date()) hrFail("Enter a valid joining date");
      out.joinedAt = d;
    }
  }
  if (input.idProofType !== undefined) {
    if (input.idProofType && !ID_PROOF_TYPES.includes(input.idProofType)) hrFail(`ID proof must be one of: ${ID_PROOF_TYPES.join(", ")}`);
    out.idProofType = input.idProofType || "";
  }
  if (input.idProofLast4 !== undefined) {
    const v = String(input.idProofLast4 || "").trim().toUpperCase();
    // Only the last 4 characters are ever stored — never the full ID number.
    if (v && !/^[A-Z0-9]{4}$/.test(v)) hrFail("Enter only the last 4 characters of the ID");
    out.idProofLast4 = v;
  }
  str("emergencyName", 80);
  if (input.emergencyPhone !== undefined) {
    const v = String(input.emergencyPhone || "").replace(/\D/g, "");
    if (v && !/^[6-9]\d{9}$/.test(v)) hrFail("Enter a valid 10-digit emergency phone number");
    out.emergencyPhone = v;
  }
  if (input.payoutUpi !== undefined) {
    const v = String(input.payoutUpi || "").trim();
    if (v && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(v)) hrFail("Enter a valid UPI ID, e.g. name@ybl");
    out.payoutUpi = v;
  }
  str("payoutBank", 120);
  return out;
};

export const updateEmployee = async ({ User, id, name, address, role, jobTitle, hr, roles = EMPLOYEE_ROLES }) => {
  const employee = await User.findOne({ _id: id, role: { $in: roles } });
  if (!employee) { const err = new Error("Employee not found"); err.statusCode = 404; throw err; }

  if (name !== undefined) employee.name = name.trim();
  if (address !== undefined) employee.address = address.trim();
  if (role !== undefined) {
    if (!roles.includes(role)) {
      const err = new Error(`Category must be one of: ${roles.join(", ")}`); err.statusCode = 400; throw err;
    }
    employee.role = role;
  }
  if (jobTitle !== undefined || role !== undefined) {
    const title = jobTitle !== undefined ? cleanJobTitle(jobTitle) : employee.jobTitle;
    if (employee.role === "staff" && !title) {
      const err = new Error("Type the role for \"Other\" (e.g. Cashier, Helper)"); err.statusCode = 400; throw err;
    }
    employee.jobTitle = employee.role === "staff" ? title : "";
  }
  if (hr && typeof hr === "object") {
    const clean = cleanHrInput(hr);
    const current = employee.hr?.toObject ? employee.hr.toObject() : (employee.hr || {});
    employee.hr = { ...current, ...clean };
  }
  await employee.save();
  return employee;
};

export const setEmployeeStatus = async ({ User, id, status, roles = EMPLOYEE_ROLES }) => {
  if (!["Active","Inactive"].includes(status)) {
    const err = new Error('status must be "Active" or "Inactive"'); err.statusCode = 400; throw err;
  }
  const employee = await User.findOneAndUpdate(
    { _id: id, role: { $in: roles } },
    { $set: { status } },
    { returnDocument: "after" }
  );
  if (!employee) { const err = new Error("Employee not found"); err.statusCode = 404; throw err; }
  return employee;
};

export const listEmployees = async ({ User, role, search, status, roles = EMPLOYEE_ROLES }) => {
  const filter = { role: { $in: roles } };
  if (role && roles.includes(role)) filter.role = role;
  if (status && ["Active","Inactive"].includes(status)) filter.status = status;
  if (search?.trim()) {
    const re = new RegExp(search.trim(), "i");
    filter.$or = [{ name: re }, { phone: re }];
  }
  return User.find(filter).sort({ createdAt: -1 }).select("-otp -otpExpiry -password");
};

/** EMP-03: every custom role used so far — offered again for the next hire. */
export const listCustomRoles = async ({ User }) => {
  const titles = await User.distinct("jobTitle", { role: "staff", jobTitle: { $nin: ["", null] } });
  const seen = new Map();
  for (const t of titles) { const k = t.toLowerCase(); if (!seen.has(k)) seen.set(k, t); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// ── Statistics ──────────────────────────────────────────────────────────────
// Days are the RESTAURANT's calendar days (RestaurantProfile.timezone, passed
// in as `tz`) — the same boundaries as the admin dashboard. The server's own
// clock is UTC on the host, which used to make a waiter's "today" run from
// 5:30 AM to 5:30 AM IST. Without a tz (old callers) it falls back to the
// server's local day.
const ymdParts = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day];
};
/** [start, end] of the calendar day y-m-d in tz (end = 1 ms before the next day). */
const dayBounds = (y, m, d, tz) => ({
  start: zonedInstant(y, m, d, 0, tz),
  end: new Date(zonedInstant(y, m, d + 1, 0, tz).getTime() - 1),
});
const todayRange = (tz) => {
  if (tz) return dayBounds(...ymdParts(new Date(), tz), tz);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
};

/** Parses "from"/"to" query params (plain "YYYY-MM-DD" dates) as LOCAL day
 * boundaries, matching todayRange()'s local-time convention — not UTC
 * midnight, which would silently shift results by a day in most timezones.
 * Falls back to today when either bound is missing. */
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const resolveRange = (from, to, tz) => {
  if (!from && !to) return todayRange(tz);
  if (tz) {
    const today = todayRange(tz);
    const f = YMD_RE.exec(String(from || "")), t = YMD_RE.exec(String(to || ""));
    return {
      start: f ? dayBounds(+f[1], +f[2], +f[3], tz).start : today.start,
      end: t ? dayBounds(+t[1], +t[2], +t[3], tz).end : today.end,
    };
  }
  const start = from ? new Date(`${from}T00:00:00`) : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const end   = to   ? new Date(`${to}T23:59:59.999`) : (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();
  return { start, end };
};

/** One employee's stats for a date range (defaults to "today") — used by the
 * Waiter/Kitchen self-service dashboards (always "today") and the admin
 * Employees "Stats" panel (optionally a custom range). Live-state counts
 * (currently PREPARING/READY/active) are never range-scoped — they reflect
 * the order's current state, not history, so a past date range wouldn't mean
 * anything for them. Counts by the field that actually names THIS employee
 * for each stage, never a generic "a waiter did this". */
export const getEmployeeTodayStats = async ({ Order, employeeId, role, from, to, tz }) => {
  const { start, end } = resolveRange(from, to, tz);
  const idMatch = { $eq: employeeId };

  if (role === "chef") {
    const [preparing, ready, completedToday, preparedToday] = await Promise.all([
      Order.countDocuments({ "preparedBy.id": idMatch, status: "PREPARING" }),
      Order.countDocuments({ "readyBy.id": idMatch, status: "READY" }),
      Order.countDocuments({ "preparedBy.id": idMatch, status: "COMPLETED", completedAt: { $gte: start, $lte: end } }),
      Order.countDocuments({ "preparedBy.id": idMatch, preparingAt: { $gte: start, $lte: end } }),
    ]);
    return {
      role: "chef",
      preparedToday, preparing, ready,
      completedToday,
    };
  }

  // waiter (and admin, if ever queried this way)
  const [confirmedToday, active, completedToday] = await Promise.all([
    Order.countDocuments({ "confirmedBy.id": idMatch, confirmedAt: { $gte: start, $lte: end } }),
    Order.countDocuments({ "confirmedBy.id": idMatch, status: { $in: ["CONFIRMED","PREPARING","READY","DELIVERED"] } }),
    Order.countDocuments({ "confirmedBy.id": idMatch, status: "COMPLETED", completedAt: { $gte: start, $lte: end } }),
  ]);
  return {
    role: "waiter",
    ordersToday: confirmedToday,
    pending: active,
    completed: completedToday,
  };
};

/** Admin-wide employee performance list, optionally scoped to a date range. */
export const getEmployeePerformance = async ({ User, Order, from, to, role, tz, roles = EMPLOYEE_ROLES }) => {
  const employees = await listEmployees({ User, role, roles });
  // Same day boundaries as every other employee figure (was new Date(from),
  // i.e. UTC midnight, and an inclusive "to" that stopped at its 00:00).
  const { start: rangeStart, end: rangeEnd } = resolveRange(from, to, tz);

  return Promise.all(employees.map(async (emp) => {
    const idMatch = { $eq: emp._id };
    let count = 0;
    if (emp.role === "chef") {
      count = await Order.countDocuments({
        "preparedBy.id": idMatch, preparingAt: { $gte: rangeStart, $lte: rangeEnd },
      });
    } else {
      count = await Order.countDocuments({
        "confirmedBy.id": idMatch, confirmedAt: { $gte: rangeStart, $lte: rangeEnd },
      });
    }
    return {
      _id: emp._id, name: emp.name, phone: emp.phone, role: emp.role,
      status: emp.status, orderCount: count,
    };
  }));
};

/** A waiter's own order activity for a date range (defaults to "today") —
 * backs the Activity tab's "My orders" / "My collection" / "Unpaid" /
 * "Cancelled" cards. Attribution mirrors getEmployeeTodayStats: orders are
 * "mine" via confirmedBy.id (the waiter who actually placed/confirmed
 * them), scoped by confirmedAt — except cancelled orders, which are scoped
 * by cancelledBy.id/cancelledAt instead, since an order can be cancelled
 * before it was ever confirmed (no confirmedBy set yet) and orderService's
 * cancelOrder() records its own actor/timestamp for exactly that reason. */
export const getWaiterOrderActivity = async ({ Order, employeeId, from, to, tz }) => {
  const { start, end } = resolveRange(from, to, tz);
  const idMatch = { $eq: employeeId };
  const FIELDS = "orderId total tableNo orderType status paymentStatus confirmedAt cancelledAt cancelReason";

  const [ordersCount, collectionAgg, unpaidOrders, cancelledOrders] = await Promise.all([
    Order.countDocuments({ "confirmedBy.id": idMatch, confirmedAt: { $gte: start, $lte: end } }),
    Order.aggregate([
      // Collection = revenue (PAID and not CANCELLED) — a paid-then-cancelled
      // order is not money the waiter took (insightsService.revenueOrderMatch).
      { $match: { "confirmedBy.id": employeeId, confirmedAt: { $gte: start, $lte: end }, ...revenueOrderMatch() } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.find({
      "confirmedBy.id": idMatch, confirmedAt: { $gte: start, $lte: end },
      paymentStatus: "PENDING_VERIFICATION", status: { $ne: "CANCELLED" },
    }).select(FIELDS).sort({ confirmedAt: -1 }).limit(100),
    Order.find({
      "cancelledBy.id": idMatch, cancelledAt: { $gte: start, $lte: end },
    }).select(FIELDS).sort({ cancelledAt: -1 }).limit(100),
  ]);

  return {
    ordersCount,
    collection: collectionAgg[0]?.total || 0,
    unpaidOrders, unpaidCount: unpaidOrders.length,
    cancelledOrders, cancelledCount: cancelledOrders.length,
  };
};
