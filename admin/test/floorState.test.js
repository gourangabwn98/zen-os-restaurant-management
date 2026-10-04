// test/floorState.test.js — DSH-04 / DSH-05 floor states (dashboard/model.js, pure).
//   node test/floorState.test.js
import assert from "node:assert/strict";
import { floorTables, currentTableOrder, FLOOR_STATE_OF, attentionItems } from "../src/pages/admin/dashboard/model.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const at = (min) => new Date(Date.UTC(2026, 9, 4, 10, min)).toISOString();
const o = (id, status, min, extra = {}) => ({ _id: id, orderId: id, orderType: "DINE_IN", tableNo: 2, status, createdAt: at(min), total: 100, ...extra });
const tables = [{ tableNo: 2, status: "Active", seats: 4 }];
const stateOf = (orders) => floorTables(tables, orders, Date.parse(at(59)))[0].state;

test("named states map 1:1 to the events that set them", () => {
  assert.equal(FLOOR_STATE_OF.CONFIRMED, "placed", "held order (ORD-01) is NOT cooking");
  assert.equal(FLOOR_STATE_OF.PENDING_CONFIRMATION, "placed");
  assert.equal(FLOOR_STATE_OF.PREPARING, "cooking", "KOT fired");
  assert.equal(FLOOR_STATE_OF.READY, "ready", "kitchen marked ready → Ready to Deliver, not Eating");
  assert.equal(FLOOR_STATE_OF.DELIVERED, "eating", "waiter tapped Served");
  assert.equal(FLOOR_STATE_OF.COMPLETED, "completed", "bill settled");
});

test("DSH-04 walk: Placed → Cooking → Ready to Deliver → Eating → Completed", () => {
  for (const [status, want] of [["CONFIRMED", "placed"], ["PREPARING", "cooking"], ["READY", "ready"], ["DELIVERED", "eating"], ["COMPLETED", "completed"]]) {
    assert.equal(stateOf([o("A", status, 1)]), want, status);
  }
  assert.equal(stateOf([]), "free");
});

test("DSH-05: a new order after Completed puts the table back on the new order's state", () => {
  const cycle = [o("A", "COMPLETED", 1, { completedAt: at(30) }), o("B", "PREPARING", 40)];
  assert.equal(stateOf(cycle), "cooking");
  assert.equal(currentTableOrder(cycle)._id, "B");
});

test("DSH-05: the newest active order wins over an older one still eating", () => {
  assert.equal(stateOf([o("A", "DELIVERED", 1), o("B", "CONFIRMED", 20)]), "placed");
  assert.equal(stateOf([o("A", "DELIVERED", 1), o("B", "READY", 20)]), "ready");
});

test("cancelled and unpaid pay-first orders never drive the floor", () => {
  assert.equal(stateOf([o("A", "CANCELLED", 1)]), "free");
  assert.equal(stateOf([o("A", "AWAITING_PAYMENT", 1)]), "free");
  assert.equal(stateOf([o("A", "COMPLETED", 1, { completedAt: at(10) }), o("B", "CANCELLED", 30)]), "completed");
});

test("serving does not settle: an Eating table reports its open bill; billing is linked, not done here", () => {
  const [t2] = floorTables(tables, [o("A", "DELIVERED", 1, { billStatus: "OPEN" })], Date.parse(at(59)));
  assert.equal(t2.billOpen, 1);
  const items = attentionItems({ billsToSettle: [o("A", "DELIVERED", 1)], awaitingConfirm: [], older: null });
  assert.equal(items[0].kind, "settle");
  assert.equal(items[0].action, "invoices");
});

console.log(`\n${passed} passed`);
