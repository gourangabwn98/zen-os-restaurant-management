// test/combinedBill.test.js — run: node test/combinedBill.test.js
import assert from "node:assert/strict";
import { parseSelection, ineligibleReason, combineTotals, combinedPrintPayload, MAX_SELECTION } from "../services/combinedBillService.js";

const id = (n) => n.toString(16).padStart(24, "a");
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message) && e.statusCode === 400);

// parseSelection — every id validated, duplicates collapse, table required
assert.deepEqual(parseSelection({ tableNo: "5", orderIds: [id(1), id(1), id(2)] }), { tableNo: 5, ids: [id(1), id(2)] });
throws(() => parseSelection({ orderIds: [id(1)] }), /tableNo/);
throws(() => parseSelection({ tableNo: 5, orderIds: [] }), /at least one/);
throws(() => parseSelection({ tableNo: 5, orderIds: [id(1), "not-an-id"] }), /Invalid order id/);
throws(() => parseSelection({ tableNo: 5, orderIds: Array.from({ length: MAX_SELECTION + 1 }, (_, i) => id(i + 1)) }), /At most/);
throws(() => parseSelection({ tableNo: 5, orderIds: { $ne: null } }), /at least one/);

// ineligibleReason — same table, dine-in, accepted & on the table only
const o = (over = {}) => ({ orderType: "DINE_IN", tableNo: 5, status: "DELIVERED", ...over });
assert.equal(ineligibleReason(o(), 5), null);
for (const st of ["CONFIRMED", "PREPARING", "READY"]) assert.equal(ineligibleReason(o({ status: st }), 5), null);
assert.equal(ineligibleReason(undefined, 5), "Order not found");
assert.equal(ineligibleReason(o({ tableNo: 6 }), 5), "Not an order of this table");
assert.equal(ineligibleReason(o({ orderType: "TAKEAWAY" }), 5), "Not an order of this table");
assert.equal(ineligibleReason(o({ status: "CANCELLED" }), 5), "Cancelled");
assert.equal(ineligibleReason(o({ status: "COMPLETED" }), 5), "Already completed");
assert.equal(ineligibleReason(o({ status: "PENDING_CONFIRMATION" }), 5), "Not accepted yet");
assert.equal(ineligibleReason(o({ status: "AWAITING_PAYMENT" }), 5), "Not accepted yet");

// combineTotals — sums of stored figures only
const A = { subtotal: 400, discount: 40, tax: 54, serviceCharge: 20, total: 434, paymentStatus: "PAID" };
const B = { subtotal: 280, discount: 0, tax: 42, serviceCharge: 10, total: 332, paymentStatus: "PENDING_VERIFICATION" };
assert.deepEqual(combineTotals([A, B]), { orderCount: 2, subtotal: 680, discount: 40, tax: 96, serviceCharge: 30, total: 766, paidTotal: 434, dueTotal: 332, allPaid: false });
assert.equal(combineTotals([A]).allPaid, true);
assert.equal(combineTotals([]).allPaid, false);

// print payload — one bill, only the given orders, staff never named as customer
const order = (orderId, extra) => ({ _id: orderId, orderId, items: [{ name: "Tea", qty: 2, price: 20 }], ...extra });
const p = combinedPrintPayload({ tableNo: 5, restaurant: { restaurantName: "X" }, orders: [
  order("ORD1", { ...A, paymentMethod: "Online", guestName: "Rahul" }),
  order("ORD2", { ...B, source: "WAITER", user: { name: "Waiter Ravi" } }),
] });
assert.equal(p.combined, true);
assert.deepEqual(p.orders.map((x) => x.orderId), ["ORD1", "ORD2"]);
assert.equal(p.total, 766); assert.equal(p.dueTotal, 332); assert.equal(p.paymentStatus, "PENDING_VERIFICATION");
assert.equal(p.guestName, "Rahul");
console.log("combinedBill: all tests passed");
