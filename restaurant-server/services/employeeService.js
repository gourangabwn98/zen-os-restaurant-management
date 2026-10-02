// services/employeeService.js
// ─────────────────────────────────────────────────────────────────────────────
// "Employee" = a User document with role in EMPLOYEE_ROLES. This is
// deliberately the SAME model that already handles admin/waiter login and
// auth — not a second, disconnected directory (that's what the old `Chef`
// model was, and why it couldn't log in as itself). Only an admin can create
// one; there is no public employee signup anywhere in this system.
// ─────────────────────────────────────────────────────────────────────────────

export const EMPLOYEE_ROLES = ["waiter", "chef"]; // extensible — add new categories here only

const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers, matching the OTP flow already in place

export const validateEmployeeInput = ({ name, phone, role }) => {
  if (!name || !name.trim()) {
    const err = new Error("Employee name is required"); err.statusCode = 400; throw err;
  }
  if (!phone || !PHONE_RE.test(String(phone).trim())) {
    const err = new Error("Enter a valid 10-digit phone number"); err.statusCode = 400; throw err;
  }
  if (!EMPLOYEE_ROLES.includes(role)) {
    const err = new Error(`Category must be one of: ${EMPLOYEE_ROLES.join(", ")}`); err.statusCode = 400; throw err;
  }
};

export const createEmployee = async ({ User, name, phone, address, role }) => {
  validateEmployeeInput({ name, phone, role });
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

export const updateEmployee = async ({ User, id, name, address, role, hr }) => {
  const employee = await User.findOne({ _id: id, role: { $in: EMPLOYEE_ROLES } });
  if (!employee) { const err = new Error("Employee not found"); err.statusCode = 404; throw err; }

  if (name !== undefined) employee.name = name.trim();
  if (address !== undefined) employee.address = address.trim();
  if (role !== undefined) {
    if (!EMPLOYEE_ROLES.includes(role)) {
      const err = new Error(`Category must be one of: ${EMPLOYEE_ROLES.join(", ")}`); err.statusCode = 400; throw err;
    }
    employee.role = role;
  }
  if (hr && typeof hr === "object") {
    const clean = cleanHrInput(hr);
    const current = employee.hr?.toObject ? employee.hr.toObject() : (employee.hr || {});
    employee.hr = { ...current, ...clean };
  }
  await employee.save();
  return employee;
};

export const setEmployeeStatus = async ({ User, id, status }) => {
  if (!["Active","Inactive"].includes(status)) {
    const err = new Error('status must be "Active" or "Inactive"'); err.statusCode = 400; throw err;
  }
  const employee = await User.findOneAndUpdate(
    { _id: id, role: { $in: EMPLOYEE_ROLES } },
    { $set: { status } },
    { new: true }
  );
  if (!employee) { const err = new Error("Employee not found"); err.statusCode = 404; throw err; }
  return employee;
};

export const listEmployees = async ({ User, role, search, status }) => {
  const filter = { role: { $in: EMPLOYEE_ROLES } };
  if (role && EMPLOYEE_ROLES.includes(role)) filter.role = role;
  if (status && ["Active","Inactive"].includes(status)) filter.status = status;
  if (search?.trim()) {
    const re = new RegExp(search.trim(), "i");
    filter.$or = [{ name: re }, { phone: re }];
  }
  return User.find(filter).sort({ createdAt: -1 }).select("-otp -otpExpiry -password");
};

// ── Statistics ──────────────────────────────────────────────────────────────
// "Today" is computed in the server's local time zone consistently (see
// Note in adminController.js's dashboard for the same pattern) so an
// employee's stats and the admin dashboard's "today" never disagree.
const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { start, end };
};

/** Parses "from"/"to" query params (plain "YYYY-MM-DD" dates) as LOCAL day
 * boundaries, matching todayRange()'s local-time convention — not UTC
 * midnight, which would silently shift results by a day in most timezones.
 * Falls back to today when either bound is missing. */
const resolveRange = (from, to) => {
  if (!from && !to) return todayRange();
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
export const getEmployeeTodayStats = async ({ Order, employeeId, role, from, to }) => {
  const { start, end } = resolveRange(from, to);
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
export const getEmployeePerformance = async ({ User, Order, from, to, role }) => {
  const employees = await listEmployees({ User, role });
  const rangeStart = from ? new Date(from) : todayRange().start;
  const rangeEnd   = to   ? new Date(to)   : todayRange().end;

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
export const getWaiterOrderActivity = async ({ Order, employeeId, from, to }) => {
  const { start, end } = resolveRange(from, to);
  const idMatch = { $eq: employeeId };
  const FIELDS = "orderId total tableNo orderType status paymentStatus confirmedAt cancelledAt cancelReason";

  const [ordersCount, collectionAgg, unpaidOrders, cancelledOrders] = await Promise.all([
    Order.countDocuments({ "confirmedBy.id": idMatch, confirmedAt: { $gte: start, $lte: end } }),
    Order.aggregate([
      { $match: { "confirmedBy.id": employeeId, confirmedAt: { $gte: start, $lte: end }, paymentStatus: "PAID" } },
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
