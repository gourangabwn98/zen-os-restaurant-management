// test/khoaiStaff.test.js
// EMP-01 manager-set shift, EMP-02 leave balance + approval-keyed pay,
// EMP-03 "Other" custom role. No DB — fakes.  node test/khoaiStaff.test.js
import assert from "node:assert/strict";
import { leaveBalance, decideLeave } from "../services/leaveService.js";
import { setEmployeeShift, shiftStateOf, sweepStaleAttendanceSessions } from "../services/attendanceService.js";
import { validateEmployeeInput, createEmployee, listCustomRoles } from "../services/employeeService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

// ── EMP-02 ──────────────────────────────────────────────────────────────────
await test("EMP-02: 4 per month, unused carries forward (no monthly reset, no cap)", () => {
  const b = leaveBalance({ joinedAt: new Date(2026, 6, 15), perMonth: 4, leaves: [], now: new Date(2026, 9, 4) });
  assert.deepEqual([b.months, b.earned, b.balance], [4, 16, 16]); // Jul, Aug, Sep, Oct
});

await test("EMP-02: approved days reduce the balance; approved beyond it still counts (balance goes negative)", () => {
  const leaves = [{ status: "APPROVED", days: 10 }, { status: "APPROVED", days: 3 }, { status: "DECLINED", days: 5 }, { status: "PENDING", days: 2 }];
  const b = leaveBalance({ joinedAt: new Date(2026, 8, 1), perMonth: 4, leaves, now: new Date(2026, 9, 4) });
  assert.equal(b.earned, 8);
  assert.equal(b.taken, 13, "only approved days are taken from the balance");
  assert.equal(b.balance, -5);
});

await test("EMP-02: deciding a request sets pay from approval — the client can't approve-unpaid or decline-paid", async () => {
  for (const [decision, paidSent, expect] of [["APPROVED", false, true], ["DECLINED", true, false]]) {
    const doc = { _id: "l1", status: "PENDING" };
    const StaffLeave = { findOneAndUpdate: async (q, u) => (q.status === doc.status ? Object.assign(doc, u.$set) : null), findById: async () => doc };
    const out = await decideLeave({ StaffLeave, leaveId: "l1", decision, paid: paidSent, actor: {} });
    assert.equal(out.paid, expect, decision);
  }
});

// ── EMP-01 ──────────────────────────────────────────────────────────────────
const attendanceWorld = () => {
  const rows = [];
  const match = (r, f) => Object.entries(f).every(([k, v]) =>
    v && typeof v === "object" && "$ne" in v ? r[k] !== v.$ne
    : v && typeof v === "object" && "$lt" in v ? r[k] < v.$lt
    : String(r[k]) === String(v));
  const AttendanceSession = {
    rows,
    create: async (doc) => { const r = { _id: `s${rows.length + 1}`, breaks: [], totalBreakSeconds: 0, ...doc }; rows.push(r); return r; },
    findOne: async (f) => rows.find((r) => match(r, f)) || null,
    find: async (f) => rows.filter((r) => match(r, f)),
    updateOne: async (f, u) => { const r = rows.find((x) => match(x, f)); if (r) Object.assign(r, u.$set); },
    findOneAndUpdate: async (f, u) => {
      const r = rows.find((x) => match(x, f));
      if (!r) return null;
      Object.assign(r, u.$set || {});
      if (u.$push?.breaks) r.breaks = [...r.breaks, u.$push.breaks];
      return r;
    },
  };
  return AttendanceSession;
};
const helper = { _id: "e1", name: "Bablu", role: "staff" };
const ACTOR = { id: "a1", role: "ADMIN", name: "Manager" };

await test("EMP-01: manager sets On Shift → On Break → On Shift → Off Shift", async () => {
  const AS = attendanceWorld();
  let r = await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "ON_SHIFT", actor: ACTOR });
  assert.equal(shiftStateOf(r.session), "ON_SHIFT");
  assert.equal(AS.rows[0].managed, true);
  assert.equal(AS.rows[0].role, "staff", "an 'Other' role employee can be put on shift");
  r = await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "ON_BREAK", reason: "Lunch", actor: ACTOR });
  assert.equal(shiftStateOf(r.session), "ON_BREAK");
  r = await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "ON_SHIFT", actor: ACTOR });
  assert.equal(shiftStateOf(r.session), "ON_SHIFT");
  r = await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "OFF_SHIFT", actor: ACTOR });
  assert.equal(AS.rows[0].status, "CLOSED");
  r = await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "OFF_SHIFT", actor: ACTOR });
  assert.equal(r.changed, false, "already off — nothing to do");
  await assert.rejects(setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "LUNCH", actor: ACTOR }), (e) => e.statusCode === 400);
});

await test("EMP-01: On Break from Off Shift is refused — only someone on duty can go on break", async () => {
  const AS = attendanceWorld();
  await assert.rejects(
    setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "ON_BREAK", reason: "Lunch", actor: ACTOR }),
    (e) => e.statusCode === 409,
  );
  assert.equal(AS.rows.length, 0, "no session opened");
});

await test("EMP-01: a manager-set shift is NOT auto-closed by the heartbeat sweep", async () => {
  const AS = attendanceWorld();
  await setEmployeeShift({ AttendanceSession: AS, employee: helper, state: "ON_SHIFT", actor: ACTOR });
  AS.rows[0].lastSeenAt = new Date(Date.now() - 60 * 60 * 1000);
  const closed = await sweepStaleAttendanceSessions({ AttendanceSession: AS });
  assert.equal(closed.length, 0);
  assert.equal(AS.rows[0].status, "OPEN");
});

// ── EMP-03 ──────────────────────────────────────────────────────────────────
await test("EMP-03: Waiter, Chef or Other — Other needs its custom role", () => {
  validateEmployeeInput({ name: "A", phone: "9876543210", role: "waiter" });
  validateEmployeeInput({ name: "A", phone: "9876543210", role: "staff", jobTitle: "Cashier" });
  assert.throws(() => validateEmployeeInput({ name: "A", phone: "9876543210", role: "staff" }), (e) => e.statusCode === 400 && /Other/.test(e.message));
  assert.throws(() => validateEmployeeInput({ name: "A", phone: "9876543210", role: "admin" }), (e) => e.statusCode === 400);
});

await test("EMP-03: the custom role is saved on the person and offered again (deduped, any case)", async () => {
  const users = [];
  const User = {
    findOne: async () => null,
    create: async (doc) => { users.push(doc); return doc; },
    distinct: async () => users.filter((u) => u.role === "staff" && u.jobTitle).map((u) => u.jobTitle),
  };
  const e = await createEmployee({ User, name: "Rina", phone: "9876543210", role: "staff", jobTitle: "  Cashier " });
  assert.equal(e.jobTitle, "Cashier");
  await createEmployee({ User, name: "Mona", phone: "9876543211", role: "staff", jobTitle: "cashier" });
  await createEmployee({ User, name: "Tapan", phone: "9876543212", role: "staff", jobTitle: "Helper" });
  await createEmployee({ User, name: "Ravi", phone: "9876543213", role: "waiter", jobTitle: "ignored" });
  assert.equal(users[3].jobTitle, "", "only Other keeps a custom role");
  assert.deepEqual(await listCustomRoles({ User }), ["Cashier", "Helper"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
