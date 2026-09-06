// test/placeOrderIdempotency.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the "Order ORD00001 placed! (but nothing persisted)"
// bug. Root cause: a keyless order that hit ANY duplicate-key error was
// funnelled into the idempotency-replay branch, which did
// `Order.findOne({ idempotencyKey: undefined })` → `findOne({})` → returned an
// arbitrary existing order as a false success.
//
// Plain-Node, no framework, no live DB. Run:  node test/placeOrderIdempotency.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { placeOrderTx } = await import("../services/orderService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack || err.message}`); }
};

// ── Fakes ──────────────────────────────────────────────────────────────────
const MENU = [{ _id: "m1", name: "Cold Coffee", price: 90, isAvailable: true }];

const makeModels = ({ orderCreate, orders = [] }) => {
  const store = [...orders];
  return {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => ({ gstRate: 0, serviceCharge: 0 }) },
    Table: { findOne: async () => null },
    TableSession: { findByIdAndUpdate: async () => ({}) },
    KOTJob: {},
    Order: {
      findOne: async (filter) => {
        // Mirror Mongoose stripping an `undefined` value from the query.
        const clean = Object.fromEntries(
          Object.entries(filter || {}).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(clean).length === 0) return store[0] || null; // findOne({})
        return store.find((o) =>
          Object.entries(clean).every(([k, v]) => String(o[k]) === String(v)),
        ) || null;
      },
      create: orderCreate,
    },
  };
};

const baseBody = {
  items: [{ menuItemId: "m1", qty: 1 }],
  orderType: "TAKEAWAY",
  customerName: "Guest",
};

const run = async () => {
  console.log("── placeOrderTx: keyless order + duplicate-key error ─────");

  await test("a keyless order whose insert hits an 11000 THROWS — never returns a stale order", async () => {
    const stale = { _id: "old", orderId: "ORD00001", total: 999 };
    const err = new Error("E11000 duplicate key error");
    err.code = 11000;
    err.keyPattern = { idempotencyKey: 1 };

    const models = makeModels({
      orders: [stale],
      orderCreate: async () => { throw err; },
    });
    const req = { models, db: {}, user: null };

    await assert.rejects(
      () => placeOrderTx({ req, body: { ...baseBody } }), // no idempotencyKey
      (e) => e.code === 11000,
      "expected the duplicate-key error to propagate, not be swallowed",
    );
  });

  await test("a keyless order that inserts cleanly is returned as a NEW order", async () => {
    const created = { _id: "new1", orderId: "ORD00002", total: 90, status: "PENDING_CONFIRMATION" };
    const models = makeModels({
      orders: [{ _id: "old", orderId: "ORD00001" }],
      orderCreate: async (payload) => ({ ...created, ...payload, _id: "new1", orderId: "ORD00002" }),
    });
    const req = { models, db: {}, user: null };

    const { order, alreadyExisted } = await placeOrderTx({ req, body: { ...baseBody } });
    assert.equal(alreadyExisted, false);
    assert.equal(order._id, "new1");
    assert.equal(order.orderId, "ORD00002");
  });

  await test("a WITH-key order whose insert races (11000) DOES return the original by key", async () => {
    const original = { _id: "orig", orderId: "ORD00005", idempotencyKey: "k-abc" };
    const err = new Error("E11000 duplicate key error");
    err.code = 11000;
    err.keyPattern = { idempotencyKey: 1 };

    const models = makeModels({
      orders: [{ _id: "old", orderId: "ORD00001" }, original],
      orderCreate: async () => { throw err; },
    });
    const req = { models, db: {}, user: null };

    const { order, alreadyExisted } = await placeOrderTx({
      req, body: { ...baseBody, idempotencyKey: "k-abc" },
    });
    assert.equal(alreadyExisted, true);
    assert.equal(order._id, "orig");
  });

  await test("re-sending the same key returns the same order without a second insert", async () => {
    const existing = { _id: "e1", orderId: "ORD00007", idempotencyKey: "k-dup" };
    let createCalls = 0;
    const models = makeModels({
      orders: [existing],
      orderCreate: async () => { createCalls++; return { _id: "should-not-happen" }; },
    });
    const req = { models, db: {}, user: null };

    const { order, alreadyExisted } = await placeOrderTx({
      req, body: { ...baseBody, idempotencyKey: "k-dup" },
    });
    assert.equal(alreadyExisted, true);
    assert.equal(order._id, "e1");
    assert.equal(createCalls, 0);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
