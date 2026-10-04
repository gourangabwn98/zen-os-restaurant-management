// test/staffHr.test.js — reviews attribution, leave rules, pay maths, HR input.
import assert from "node:assert/strict";
import { attributeOrder, cleanRating, markLookedInto } from "../services/reviewService.js";
import { validateRange, leaveDaysInRange, decideLeave, daysBetween } from "../services/leaveService.js";
import { overtimeSeconds, computePay, monthRange } from "../services/payService.js";
import { cleanHrInput } from "../services/employeeService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};
const rejects = async (fn, status) => {
  try { await fn(); } catch (err) { assert.equal(err.statusCode, status, err.message); return; }
  throw new Error(`expected a ${status} error`);
};
const throwsStatus = (fn, status) => assert.throws(fn, (e) => e.statusCode === status);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

console.log("reviews");
await test("food → chef who marked it ready, service → waiter who confirmed", () => {
  const who = attributeOrder({
    confirmedBy: { id: "w1", role: "WAITER", name: "Rahul Sen" },
    preparedBy: { id: "c2", role: "CHEF", name: "Bikash" },
    readyBy: { id: "c1", role: "CHEF", name: "Malati" },
  });
  assert.equal(who.FOOD.id, "c1");
  assert.equal(who.SERVICE.id, "w1");
});
await test("admin-confirmed / timer-prepared orders have no staff to rate", () => {
  const who = attributeOrder({
    confirmedBy: { id: "a1", role: "ADMIN" }, preparedBy: { id: null, role: "SYSTEM" },
  });
  assert.equal(who.FOOD, null);
  assert.equal(who.SERVICE, null);
});
await test("falls back to the waiter who delivered it", () => {
  assert.equal(attributeOrder({ confirmedBy: { id: "a1", role: "ADMIN" }, deliveredBy: { id: "w2", role: "WAITER" } }).SERVICE.id, "w2");
});
await test("2★ or a negative tag is a complaint; unknown tags are dropped", () => {
  assert.equal(cleanRating("SERVICE", { rating: 2, tags: [] }).complaint, true);
  const r = cleanRating("SERVICE", { rating: 5, tags: ["Rude", "Hacked"] });
  assert.deepEqual(r.tags, ["Rude"]);
  assert.equal(r.complaint, true);
  assert.equal(cleanRating("FOOD", { rating: 4, tags: ["Tasty"] }).complaint, false);
  assert.equal(cleanRating("FOOD", null), null);
  throwsStatus(() => cleanRating("FOOD", { rating: 6 }), 400);
  throwsStatus(() => cleanRating("FOOD", { rating: 2.5 }), 400);
});
await test("a complaint can be marked looked into only once", async () => {
  const store = { _id: "r1", complaint: true, lookedInto: null };
  const StaffReview = {
    findOneAndUpdate: async (q, u) => (q._id === store._id && store.complaint && store.lookedInto === null
      ? Object.assign(store, u.$set) : null),
    findById: async () => store,
  };
  await markLookedInto({ StaffReview, reviewId: "r1", note: "Spoke to staff", actor: { id: "a" } });
  assert.equal(store.lookedInto.note, "Spoke to staff");
  await rejects(() => markLookedInto({ StaffReview, reviewId: "r1", note: "again", actor: {} }), 409);
  await rejects(() => markLookedInto({ StaffReview, reviewId: "r1", note: "  ", actor: {} }), 400);
});

console.log("leave");
await test("dates: inclusive days, no past start for staff, max 31, end ≥ start", () => {
  assert.equal(validateRange(ymd(addDays(1)), ymd(addDays(2))).days, 2);
  throwsStatus(() => validateRange(ymd(addDays(-1)), ymd(addDays(1))), 400);
  assert.equal(validateRange(ymd(addDays(-3)), ymd(addDays(-3)), { allowPast: true }).days, 1);
  throwsStatus(() => validateRange(ymd(addDays(5)), ymd(addDays(2))), 400);
  throwsStatus(() => validateRange(ymd(addDays(1)), ymd(addDays(40))), 400);
  throwsStatus(() => validateRange("2026-02-30", "2026-03-01", { allowPast: true }), 400);
});
await test("EMP-02: approved days are paid (whatever the old flag); declined + past pending days are LOP", () => {
  const start = new Date(2026, 8, 1), end = new Date(2026, 8, 30, 23, 59, 59);
  const leaves = [
    { status: "APPROVED", paid: true, from: new Date(2026, 8, 10), to: new Date(2026, 8, 10) },
    { status: "APPROVED", paid: false, from: new Date(2026, 8, 29), to: new Date(2026, 9, 2) }, // 2 days in Sep
    { status: "PENDING", paid: false, from: new Date(2026, 8, 5), to: new Date(2026, 8, 6) },
    { status: "DECLINED", paid: false, from: new Date(2026, 8, 7), to: new Date(2026, 8, 7) },
  ];
  // approved: 1 + 2 (Sep part) = 3 paid; declined 1 + pending-already-past 2 = 3 LOP
  assert.deepEqual(leaveDaysInRange(leaves, start, end, new Date(2026, 9, 4)), { paid: 3, unpaid: 3 });
  // a pending request for days still ahead isn't LOP yet
  assert.deepEqual(leaveDaysInRange(leaves, start, end, new Date(2026, 8, 1)), { paid: 3, unpaid: 1 });
  assert.equal(daysBetween(new Date(2026, 9, 1), new Date(2026, 9, 2)), 2);
});
await test("a request is decided once (atomic PENDING → …)", async () => {
  const doc = { _id: "l1", status: "PENDING" };
  const StaffLeave = {
    findOneAndUpdate: async (q, u) => (q.status === doc.status ? Object.assign(doc, u.$set) : null),
    findById: async () => doc,
  };
  const out = await decideLeave({ StaffLeave, leaveId: "l1", decision: "APPROVED", paid: true, actor: {} });
  assert.equal(out.status, "APPROVED");
  assert.equal(out.paid, true);
  await rejects(() => decideLeave({ StaffLeave, leaveId: "l1", decision: "DECLINED", actor: {} }), 409);
  await rejects(() => decideLeave({ StaffLeave, leaveId: "l1", decision: "MAYBE", actor: {} }), 400);
});

console.log("pay");
await test("overtime: per day beyond shift hours, open shifts excluded", () => {
  const day = (d, h, status = "CLOSED") => ({ status, loginAt: new Date(2026, 8, d, 9), totalWorkingSeconds: h * 3600 });
  const r = overtimeSeconds([day(1, 10), day(2, 7), day(3, 4), day(3, 5.5), day(4, 12, "OPEN")], 8);
  assert.equal(r.otSeconds, (2 + 1.5) * 3600); // day 1: +2h, day 3: 9.5h → +1.5h
  assert.equal(r.daysWorked, 3);
});
await test("net = salary + overtime − unpaid leave − advances (never negative)", () => {
  const sessions = [{ status: "CLOSED", loginAt: new Date(2026, 8, 1, 9), totalWorkingSeconds: 10 * 3600 }];
  const b = computePay({ hr: { salary: 9000, otRate: 60, shiftHours: 8 }, sessions, advances: [{ amount: 1000 }], unpaidLeaveDays: 1 });
  assert.equal(b.overtime, 120);    // 2h × ₹60
  assert.equal(b.unpaidLeave, 300); // 9000 ÷ 30 × 1
  assert.equal(b.net, 9000 + 120 - 300 - 1000);
  assert.equal(computePay({ hr: { salary: 500 }, advances: [{ amount: 2000 }] }).net, 0);
  assert.equal(computePay({}).net, 0);
});
await test("month keys", () => {
  assert.equal(monthRange("2026-02").end.getDate(), 28);
  throwsStatus(() => monthRange("2026-13"), 400);
  throwsStatus(() => monthRange("26-1"), 400);
});

console.log("documents / hr input");
await test("whitelist + validation; ID keeps only the last 4", () => {
  const out = cleanHrInput({ salary: "12000", otRate: 60, idProofType: "Aadhaar", idProofLast4: "4821", emergencyPhone: "98765 43210", payoutUpi: "malati@ybl", isAdmin: true, role: "admin" });
  assert.deepEqual(Object.keys(out).sort(), ["emergencyPhone", "idProofLast4", "idProofType", "otRate", "payoutUpi", "salary"]);
  assert.equal(out.salary, 12000);
  assert.equal(out.emergencyPhone, "9876543210");
  throwsStatus(() => cleanHrInput({ idProofLast4: "123456789012" }), 400);
  throwsStatus(() => cleanHrInput({ salary: -5 }), 400);
  throwsStatus(() => cleanHrInput({ payoutUpi: "not a upi" }), 400);
  throwsStatus(() => cleanHrInput({ idProofType: "Ration card" }), 400);
  throwsStatus(() => cleanHrInput({ joinedAt: "2999-01-01" }), 400);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
