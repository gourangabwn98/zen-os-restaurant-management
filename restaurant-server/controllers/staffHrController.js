// controllers/staffHrController.js
// Thin HTTP wrappers for the Employees page's Reviews / Pay / Leave /
// Documents tabs and the staff apps' "Request leave". Logic lives in
// services/reviewService.js, leaveService.js, payService.js.
import { EMPLOYEE_ROLES } from "../services/employeeService.js";
import { buildActor } from "../services/orderService.js";
import { listEmployeeReviews, markLookedInto, reviewSummaryByEmployee, LOOKED_INTO_NOTES, REVIEW_TAGS } from "../services/reviewService.js";
import { requestLeave, recordLeave, decideLeave, cancelOwnLeave, listLeaves, leaveDaysInRange } from "../services/leaveService.js";
import { getEmployeePay, recordAdvance, markSalaryPaid, teamPaySummary, monthRange, PAY_METHODS } from "../services/payService.js";
import { uploadToCloudinary } from "../middleware/uploadMiddleware.js";

const send = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};
const notFound = () => { const err = new Error("Employee not found"); err.statusCode = 404; return err; };
const findStaff = async (User, id) => {
  const emp = await User.findOne({ _id: id, role: { $in: EMPLOYEE_ROLES } }).select("-otp -otpExpiry -password");
  if (!emp) throw notFound();
  return emp;
};
const getPolicy = async (RestaurantProfile) => {
  const p = await RestaurantProfile.findOne().select("staffPolicy").lean();
  return { paidLeavePerMonth: p?.staffPolicy?.paidLeavePerMonth ?? 1, salaryDay: p?.staffPolicy?.salaryDay ?? 5 };
};

// ── Team summary (strip + list flags) ── GET /admin/employees/hr/summary?month=
export const hrSummary = send(async (req, res) => {
  const { User, StaffLeave, StaffReview, RestaurantProfile } = req.models;
  const employees = await User.find({ role: { $in: EMPLOYEE_ROLES }, status: { $ne: "Inactive" } }).select("hr name role").lean();
  const [pending, reviews, pay, policy] = await Promise.all([
    StaffLeave.find({ status: "PENDING" }).select("employee from to days").lean(),
    reviewSummaryByEmployee({ StaffReview }),
    teamPaySummary({ models: req.models, employees, month: req.query.month }),
    getPolicy(RestaurantProfile),
  ]);
  const people = {};
  const ensure = (id) => (people[id] ||= { pendingLeave: 0, openComplaints: 0, rating: null, reviews: 0, pay: null });
  for (const l of pending) ensure(String(l.employee)).pendingLeave += 1;
  for (const [id, r] of Object.entries(reviews)) Object.assign(ensure(id), { openComplaints: r.openComplaints, rating: r.avg, reviews: r.count });
  for (const [id, p] of Object.entries(pay.perEmployee)) ensure(id).pay = p;
  res.json({
    month: pay.month,
    totals: {
      pendingLeaves: pending.length,
      openComplaints: Object.values(reviews).reduce((s, r) => s + r.openComplaints, 0),
      salaryDue: pay.due, unpaidPeople: pay.unpaidPeople, salaryPaid: pay.paidTotal,
    },
    people, policy,
  });
});

export const updatePolicy = send(async (req, res) => {
  const { RestaurantProfile } = req.models;
  const set = {};
  const { paidLeavePerMonth, salaryDay } = req.body || {};
  if (paidLeavePerMonth !== undefined) {
    const v = Number(paidLeavePerMonth);
    if (!Number.isInteger(v) || v < 0 || v > 31) { const e = new Error("Paid leave per month must be 0–31"); e.statusCode = 400; throw e; }
    set["staffPolicy.paidLeavePerMonth"] = v;
  }
  if (salaryDay !== undefined) {
    const v = Number(salaryDay);
    if (!Number.isInteger(v) || v < 1 || v > 28) { const e = new Error("Salary day must be 1–28"); e.statusCode = 400; throw e; }
    set["staffPolicy.salaryDay"] = v;
  }
  const profile = await RestaurantProfile.findOneAndUpdate({}, { $set: set }, { returnDocument: "after" });
  if (!profile) { const e = new Error("Set up the restaurant profile first"); e.statusCode = 409; throw e; }
  res.json({ policy: profile.staffPolicy });
});

// ── Reviews ──
export const getReviews = send(async (req, res) => {
  const { User, StaffReview } = req.models;
  const emp = await findStaff(User, req.params.id);
  const data = await listEmployeeReviews({ StaffReview, employeeId: emp._id, filter: req.query.filter });
  res.json({ ...data, lookedIntoNotes: LOOKED_INTO_NOTES, tags: REVIEW_TAGS });
});

export const reviewLookedInto = send(async (req, res) => {
  const { StaffReview } = req.models;
  const review = await markLookedInto({ StaffReview, reviewId: req.params.reviewId, note: req.body?.note, actor: buildActor(req.user) });
  res.json({ review });
});

// ── Pay ──
export const getPay = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  const data = await getEmployeePay({ models: req.models, employee: emp, month: req.query.month });
  res.json({ ...data, methods: PAY_METHODS, hr: emp.hr || {} });
});

export const addAdvance = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  const { month, amount, method, note } = req.body || {};
  const row = await recordAdvance({ StaffPay: req.models.StaffPay, employeeId: emp._id, month, amount, method, note, actor: buildActor(req.user) });
  res.status(201).json({ advance: row });
});

export const paySalary = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  const row = await markSalaryPaid({ models: req.models, employee: emp, month: req.body?.month, method: req.body?.method, actor: buildActor(req.user) });
  res.status(201).json({ salary: row });
});

// ── Leave (admin) ──
const leaveView = async (models, employeeId) => {
  const { StaffLeave, RestaurantProfile } = models;
  const [leaves, policy] = await Promise.all([listLeaves({ StaffLeave, employeeId }), getPolicy(RestaurantProfile)]);
  const { start, end, key } = monthRange();
  const used = leaveDaysInRange(leaves, start, end);
  return {
    leaves,
    month: key,
    balance: { allowance: policy.paidLeavePerMonth, paidUsed: used.paid, unpaidUsed: used.unpaid, paidLeft: Math.max(0, policy.paidLeavePerMonth - used.paid) },
  };
};

export const getLeave = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  res.json(await leaveView(req.models, emp._id));
});

export const addLeave = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  const { from, to, reason, paid } = req.body || {};
  const leave = await recordLeave({ StaffLeave: req.models.StaffLeave, employeeId: emp._id, from, to, reason, paid, actor: buildActor(req.user) });
  res.status(201).json({ leave });
});

export const decide = send(async (req, res) => {
  const { decision, paid } = req.body || {};
  const leave = await decideLeave({ StaffLeave: req.models.StaffLeave, leaveId: req.params.leaveId, decision, paid, actor: buildActor(req.user) });
  res.json({ leave });
});

// ── Documents: photo ──
export const uploadPhoto = send(async (req, res) => {
  const emp = await findStaff(req.models.User, req.params.id);
  if (!req.file) { const e = new Error("Choose a photo"); e.statusCode = 400; throw e; }
  const url = await uploadToCloudinary(req.file.buffer, "staff");
  const current = emp.hr?.toObject ? emp.hr.toObject() : (emp.hr || {});
  emp.hr = { ...current, photo: url };
  await emp.save();
  res.json({ employee: emp });
});

// ── Staff self-service (waiter / chef apps) ──
export const myLeave = send(async (req, res) => {
  res.json(await leaveView(req.models, req.user._id));
});

export const myLeaveRequest = send(async (req, res) => {
  const { from, to, reason } = req.body || {};
  const leave = await requestLeave({ StaffLeave: req.models.StaffLeave, employee: req.user, from, to, reason, actor: buildActor(req.user) });
  res.status(201).json({ leave });
});

export const myLeaveCancel = send(async (req, res) => {
  const leave = await cancelOwnLeave({ StaffLeave: req.models.StaffLeave, leaveId: req.params.leaveId, employeeId: req.user._id });
  res.json({ leave });
});
