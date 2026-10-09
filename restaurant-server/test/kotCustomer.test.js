// test/kotCustomer.test.js — KH-08: customer's name on the paper KOT only.
// No DB — fakes.  node test/kotCustomer.test.js
import assert from "node:assert/strict";
import { kotCustomerName, kotCustomerPhone, kitchenSafeKot, createKotJobForOrder } from "../services/kotService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

const fakeKOTJob = () => {
  const rows = [];
  return {
    rows,
    create: async ([doc]) => {
      if (rows.some((r) => String(r.order) === String(doc.order))) { const e = new Error("dup"); e.code = 11000; throw e; }
      const row = { _id: `k${rows.length + 1}`, ...doc };
      rows.push(row);
      return [row];
    },
    findOne: (q) => ({ session: async () => rows.find((r) => String(r.order) === String(q.order)) || null }),
  };
};
const order = (over = {}) => ({
  _id: "o1", orderId: "ORD00142", tableNo: 5, orderType: "DINE_IN", notes: "",
  items: [{ name: "Chicken Biryani", qty: 2, notes: "" }], ...over,
});

await test("name: typed guest name wins, trimmed and spaces collapsed", () => {
  assert.equal(kotCustomerName({ source: "WAITER", guestName: "  Rahul   Das " }), "Rahul Das");
  assert.equal(kotCustomerName({ source: "CUSTOMER", guestName: "Priya" }, "Account Name"), "Priya");
});

await test("name: account name only on a customer-placed order, never the waiter's", () => {
  assert.equal(kotCustomerName({ source: "CUSTOMER" }, "Priya Sen"), "Priya Sen");
  assert.equal(kotCustomerName({}, "Old Order Customer"), "Old Order Customer", "old orders without source = customer");
  assert.equal(kotCustomerName({ source: "WAITER" }, "Rahul (waiter)"), "", "staff order: user is the waiter");
  assert.equal(kotCustomerName({ source: "ADMIN" }, "Owner"), "");
});

await test("name: no name at all → empty (KOT leaves the line out)", () => {
  assert.equal(kotCustomerName({ source: "WAITER" }), "");
  assert.equal(kotCustomerName({ source: "CUSTOMER", guestName: "   " }, ""), "");
  assert.equal(kotCustomerName(null), "");
});

await test("name: absurdly long input is capped (layout wraps the rest)", () => {
  assert.equal(kotCustomerName({ guestName: "x".repeat(300) }).length, 100);
});

await test("KOT job stores the name; same idempotency (one KOT per order) as before", async () => {
  const KOTJob = fakeKOTJob();
  const r1 = await createKotJobForOrder({ KOTJob, order: order(), actor: {}, customerName: "Rahul" });
  assert.equal(r1.created, true);
  assert.equal(r1.job.customerName, "Rahul");
  const r2 = await createKotJobForOrder({ KOTJob, order: order(), actor: {}, customerName: "Other" });
  assert.equal(r2.created, false, "second attempt returns the existing KOT");
  assert.equal(KOTJob.rows.length, 1);
});

await test("KOT job without a name stores \"\" (old callers unchanged)", async () => {
  const KOTJob = fakeKOTJob();
  const r = await createKotJobForOrder({ KOTJob, order: order(), actor: {} });
  assert.equal(r.job.customerName, "");
  assert.deepEqual(r.job.items, [{ name: "Chicken Biryani", nameBn: "", qty: 2, notes: "" }]);
});

await test("kitchenSafeKot strips the name (plain object and mongoose-like doc), keeps everything else", () => {
  const job = { _id: "k1", orderId: "ORD1", items: [{ name: "Tea", qty: 1 }], customerName: "Rahul" };
  const safe = kitchenSafeKot(job);
  assert.equal("customerName" in safe, false);
  assert.equal(safe.orderId, "ORD1");
  assert.equal(job.customerName, "Rahul", "the original (printer copy) is not mutated");
  const doc = { toObject: () => ({ orderId: "ORD2", customerName: "Priya" }) };
  assert.equal("customerName" in kitchenSafeKot(doc), false);
  assert.equal(kitchenSafeKot(null), null);
});

await test("phone: typed guest phone, else the account's only on a customer order — never the waiter's", () => {
  assert.equal(kotCustomerPhone({ source: "WAITER", guestPhone: "98765 43210" }), "9876543210");
  assert.equal(kotCustomerPhone({ source: "CUSTOMER" }, "+919000000001"), "+919000000001");
  assert.equal(kotCustomerPhone({ source: "WAITER" }, "9111111111"), "", "staff order: account is the waiter");
  assert.equal(kotCustomerPhone({ source: "ADMIN" }), "");
});

await test("KOT job stores the phone for paper; the Kitchen app copy never has it", async () => {
  const KOTJob = fakeKOTJob();
  const { job } = await createKotJobForOrder({ KOTJob, order: order(), actor: {}, customerName: "Rahul", customerPhone: "9876543210" });
  assert.equal(job.customerPhone, "9876543210");
  const safe = kitchenSafeKot(job);
  assert.equal("customerPhone" in safe, false);
  assert.equal("customerName" in safe, false);
  assert.equal((await createKotJobForOrder({ KOTJob: fakeKOTJob(), order: order(), actor: {} })).job.customerPhone, "");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
