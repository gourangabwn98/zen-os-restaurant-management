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

export const updateEmployee = async ({ User, id, name, address, role }) => {
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

/** One employee's own "today" stats — used by both the Waiter and Kitchen
 * apps' self-service dashboard. Counts by the field that actually names
 * THIS employee for each stage, never a generic "a waiter did this". */
export const getEmployeeTodayStats = async ({ Order, employeeId, role }) => {
  const { start, end } = todayRange();
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
