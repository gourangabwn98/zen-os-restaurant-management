// test/acServiceCharge.test.js — KH-11: AC Room service charge = guests × rate.
// No DB — fakes.  node test/acServiceCharge.test.js
import assert from "node:assert/strict";
import {
  parseGuests, guestChargeUpdate, applyGuestsToOrder, applyGuestsToSelection, acRateFor, isChargeLocked,
} from "../services/acServiceCharge.js";
import { computeTotals } from "../utils/pricing.js";
import { combinedPrintPayload, combineTotals } from "../services/combinedBillService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const PROFILE = { acServiceChargePerGuest: 20 };
const acOrder = (over = {}) => ({
  _id: "o1", orderId: "ORD1", orderType: "DINE_IN", diningArea: "AC_ROOM", tableNo: 12, status: "DELIVERED",
  billStatus: "OPEN", paymentStatus: "PENDING_VERIFICATION", subtotal: 500, tax: 0, serviceCharge: 0, discount: 0,
  total: 500, acServiceCharge: 0, items: [], ...over,
});

// In-memory Order with the same conditional-update semantics as Mongo for the filter we use.
const makeOrders = (rows) => ({
  rows,
  findOneAndUpdate: async (q, u) => {
    const o = rows.find((r) => r._id === q._id);
    if (!o) return null;
    const charge = Number(o.acServiceCharge) || 0;
    const chargeOk = q.acServiceCharge?.$in ? q.acServiceCharge.$in.includes(o.acServiceCharge ?? null) || charge === 0 : charge === q.acServiceCharge;
    if (o.total !== q.total || !chargeOk || o.paymentStatus === "PAID" || o.billStatus === "SETTLED" || ["COMPLETED", "CANCELLED"].includes(o.status)) return null;
    Object.assign(o, u.$set);
    return { ...o };
  },
});

await test("parseGuests: 1..100 whole numbers; empty = not asked", () => {
  assert.equal(parseGuests("4"), 4);
  assert.equal(parseGuests(undefined), null);
  assert.equal(parseGuests(""), null);
  for (const bad of [0, -1, 2.5, "x", 101]) assert.throws(() => parseGuests(bad), (e) => e.statusCode === 400);
});

await test("AC Room: 4 guests × ₹20 = ₹80 service charge, added to the total; rate snapshotted", async () => {
  const Order = makeOrders([acOrder()]);
  const u = await applyGuestsToOrder({ Order, order: acOrder(), guests: 4, profile: PROFILE });
  assert.equal(u.acServiceCharge, 80);
  assert.equal(u.acServiceRate, 20);
  assert.equal(u.guests, 4);
  assert.equal(u.total, 580);
});

await test("reprint with an edited guest count replaces (not adds) the charge, at the SAME snapshotted rate", async () => {
  const first = acOrder({ guests: 4, acServiceRate: 20, acServiceCharge: 80, total: 580 });
  const Order = makeOrders([{ ...first }]);
  const u = await applyGuestsToOrder({ Order, order: first, guests: 6, profile: { acServiceChargePerGuest: 50 } });
  assert.equal(u.acServiceCharge, 120, "rate stays ₹20 although the profile now says ₹50");
  assert.equal(u.total, 620);
});

await test("changing the rate affects only bills not printed yet", () => {
  assert.equal(acRateFor({ acServiceRate: 20 }, { acServiceChargePerGuest: 30 }), 20);
  assert.equal(acRateFor({}, { acServiceChargePerGuest: 30 }), 30);
  assert.equal(acRateFor({}, {}), 20, "default ₹20");
  assert.equal(acRateFor({}, { acServiceChargePerGuest: 0 }), 0);
});

await test("not AC Room (hall / garden / takeaway): guests recorded, no charge, total unchanged", () => {
  for (const o of [acOrder({ diningArea: "" }), acOrder({ diningArea: "GARDEN" }), acOrder({ orderType: "TAKEAWAY", diningArea: "", tableNo: null })]) {
    assert.deepEqual(guestChargeUpdate(o, 4, PROFILE), { guests: 4 });
  }
});

await test("paid / settled / completed / cancelled bills never change", async () => {
  for (const o of [acOrder({ paymentStatus: "PAID" }), acOrder({ billStatus: "SETTLED" }), acOrder({ status: "COMPLETED", billStatus: undefined }), acOrder({ status: "CANCELLED" })]) {
    assert.equal(isChargeLocked(o), true);
    assert.equal(guestChargeUpdate(o, 4, PROFILE), null);
    const Order = makeOrders([{ ...o }]);
    const same = await applyGuestsToOrder({ Order, order: o, guests: 4, profile: PROFILE });
    assert.equal(same.total, o.total);
  }
});

await test("race: the order changed after it was read → 409, nothing written", async () => {
  const Order = makeOrders([acOrder({ total: 650 })]); // someone added items meanwhile
  await assert.rejects(applyGuestsToOrder({ Order, order: acOrder(), guests: 2, profile: PROFILE }), (e) => e.statusCode === 409);
  assert.equal(Order.rows[0].acServiceCharge, 0);
});

await test("older orders without the field still work (acServiceCharge missing)", async () => {
  const old = acOrder(); delete old.acServiceCharge;
  const Order = makeOrders([{ ...old }]);
  const u = await applyGuestsToOrder({ Order, order: old, guests: 3, profile: PROFILE });
  assert.equal(u.total, 560);
});

await test("re-pricing an edited order keeps the charge (computeTotals carries it)", () => {
  const t = computeTotals([{ price: 100, qty: 5 }], { gstRate: 5 }, null, { acServiceCharge: 80 });
  assert.equal(t.tax, 25, "GST on items only, not on the service charge");
  assert.equal(t.total, 605);
  assert.equal(computeTotals([{ price: 100, qty: 5 }], { gstRate: 0 }).total, 500, "no charge → exactly as before");
});

await test("combined bill: guests once → charge on ONE AC order, any other open AC charge reset (no double)", async () => {
  const a = acOrder({ _id: "a", orderId: "A" });
  const b = acOrder({ _id: "b", orderId: "B", total: 300, acServiceCharge: 60, guests: 3, acServiceRate: 20 }); // printed alone before
  const hall = acOrder({ _id: "h", orderId: "H", diningArea: "" });
  const Order = makeOrders([{ ...a }, { ...b }, { ...hall }]);
  const wrote = await applyGuestsToSelection({ Order, orders: [a, b, hall], guests: 5, profile: PROFILE });
  assert.equal(wrote, true);
  const byId = Object.fromEntries(Order.rows.map((r) => [r._id, r]));
  assert.equal(byId.a.acServiceCharge, 100);
  assert.equal(byId.a.total, 600);
  assert.equal(byId.b.acServiceCharge, 0);
  assert.equal(byId.b.total, 240);
  assert.equal(byId.h.total, 500, "hall order untouched");
  assert.equal(combineTotals(Order.rows).acServiceCharge, 100);
});

await test("combined bill: an already PAID order carrying the charge → guests already billed, nothing changes", async () => {
  const paid = acOrder({ _id: "p", paymentStatus: "PAID", acServiceCharge: 80, total: 580 });
  const open = acOrder({ _id: "o" });
  const Order = makeOrders([{ ...paid }, { ...open }]);
  assert.equal(await applyGuestsToSelection({ Order, orders: [paid, open], guests: 4, profile: PROFILE }), false);
  assert.equal(Order.rows[1].total, 500);
});

await test("combined payload shows the charge with guests × rate", () => {
  const p = combinedPrintPayload({ tableNo: 12, orders: [acOrder({ acServiceCharge: 100, guests: 5, acServiceRate: 20, total: 600 }), acOrder({ _id: "x", orderId: "X" })] });
  assert.equal(p.acServiceCharge, 100);
  assert.equal(p.guests, 5);
  assert.equal(p.acServiceRate, 20);
  assert.equal(p.total, 1100);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
