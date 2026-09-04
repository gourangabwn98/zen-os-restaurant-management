// test/orderLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Plain-Node assertion tests (no test framework dependency) for the two
// pieces of Phase 1 logic that don't require a live MongoDB connection:
// the order state machine and server-side pricing. Run with:
//   node test/orderLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import {
  validateTransition, assertValidTransition, isTerminalStatus, normalizeOrderType,
  ORDER_STATUSES,
} from "../utils/orderStateMachine.js";
import { priceItems, computeTotals, priceOrder } from "../utils/pricing.js";

let passed = 0;
let failed = 0;

/** Async-aware — always await this at the call site. */
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.message}`);
  }
};

const run = async () => {
  console.log("── orderStateMachine ──────────────────────────");

  await test("customer can cancel a pending-confirmation order", () => {
    const r = validateTransition("PENDING_CONFIRMATION", "CANCELLED", "customer");
    assert.equal(r.ok, true);
  });

  await test("customer CANNOT cancel a confirmed order", () => {
    const r = validateTransition("CONFIRMED", "CANCELLED", "customer");
    assert.equal(r.ok, false);
    assert.equal(r.code, 403);
  });

  await test("waiter can confirm a pending order", () => {
    const r = validateTransition("PENDING_CONFIRMATION", "CONFIRMED", "waiter");
    assert.equal(r.ok, true);
  });

  await test("customer CANNOT confirm an order", () => {
    const r = validateTransition("PENDING_CONFIRMATION", "CONFIRMED", "customer");
    assert.equal(r.ok, false);
    assert.equal(r.code, 403);
  });

  await test("waiter CANNOT cancel once PREPARING (admin-only override)", () => {
    const r = validateTransition("PREPARING", "CANCELLED", "waiter");
    assert.equal(r.ok, false);
  });

  await test("admin CAN cancel while PREPARING", () => {
    const r = validateTransition("PREPARING", "CANCELLED", "admin");
    assert.equal(r.ok, true);
  });

  await test("cannot skip straight from PENDING_CONFIRMATION to READY", () => {
    const r = validateTransition("PENDING_CONFIRMATION", "READY", "admin");
    assert.equal(r.ok, false);
    assert.equal(r.code, 400);
  });

  await test("cannot transition out of a terminal state", () => {
    const r = validateTransition("COMPLETED", "CANCELLED", "admin");
    assert.equal(r.ok, false);
  });

  await test("cannot transition to the same status", () => {
    const r = validateTransition("PREPARING", "PREPARING", "admin");
    assert.equal(r.ok, false);
  });

  await test("unknown target status is rejected", () => {
    const r = validateTransition("PREPARING", "FROZEN", "admin");
    assert.equal(r.ok, false);
    assert.equal(r.code, 400);
  });

  await test("full happy-path chain is walkable by staff", () => {
    const chain = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED"];
    for (let i = 0; i < chain.length - 1; i++) {
      const r = validateTransition(chain[i], chain[i + 1], "admin");
      assert.equal(r.ok, true, `${chain[i]} -> ${chain[i + 1]} should be ok`);
    }
  });

  await test("assertValidTransition throws with a statusCode on an illegal move", () => {
    assert.throws(
      () => assertValidTransition("COMPLETED", "PREPARING", "admin"),
      (err) => err.statusCode === 400 || err.statusCode === 500
    );
  });

  await test("isTerminalStatus is correct for COMPLETED/CANCELLED and false otherwise", () => {
    assert.equal(isTerminalStatus("COMPLETED"), true);
    assert.equal(isTerminalStatus("CANCELLED"), true);
    assert.equal(isTerminalStatus("PENDING_CONFIRMATION"), false);
  });

  await test("every canonical status appears in ORDER_STATUSES", () => {
    for (const s of ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"]) {
      assert.ok(ORDER_STATUSES.includes(s));
    }
  });

  await test("normalizeOrderType maps legacy customer-app strings", () => {
    assert.equal(normalizeOrderType("Dining"), "DINE_IN");
    assert.equal(normalizeOrderType("Take Away"), "TAKEAWAY");
    assert.equal(normalizeOrderType("Delivery"), "ONLINE");
  });

  await test("normalizeOrderType passes through already-canonical values", () => {
    assert.equal(normalizeOrderType("DINE_IN"), "DINE_IN");
    assert.equal(normalizeOrderType("TAKEAWAY"), "TAKEAWAY");
    assert.equal(normalizeOrderType("ONLINE"), "ONLINE");
  });

  await test("normalizeOrderType falls back to DINE_IN for junk/empty input", () => {
    assert.equal(normalizeOrderType(undefined), "DINE_IN");
    assert.equal(normalizeOrderType("banana"), "DINE_IN");
  });

  console.log("── pricing ─────────────────────────────────────");

  await test("computeTotals: subtotal, tax, service charge, total are correct", () => {
    const dbItems = [
      { price: 100, qty: 2 }, // 200
      { price: 50,  qty: 3 }, // 150
    ];
    const restaurant = { gstRate: 5, serviceCharge: 10 }; // 5% GST, ₹10/item service charge
    const totals = computeTotals(dbItems, restaurant);
    assert.equal(totals.subtotal, 350);
    assert.equal(totals.totalQty, 5);
    assert.equal(totals.tax, Math.round(350 * 0.05)); // 18
    assert.equal(totals.serviceCharge, 10 * 5);        // 50
    assert.equal(totals.discount, 0);
    assert.equal(totals.total, 350 + 18 + 50);
  });

  await test("computeTotals handles a missing restaurant profile (defaults to 0 rates)", () => {
    const totals = computeTotals([{ price: 20, qty: 1 }], null);
    assert.equal(totals.subtotal, 20);
    assert.equal(totals.tax, 0);
    assert.equal(totals.serviceCharge, 0);
    assert.equal(totals.total, 20);
  });

  // ── Fake MenuItem model (no DB needed) ──────────────────────────────────
  const catalog = [
    { _id: "m1", name: "Paneer Tikka",  price: 220, isAvailable: true },
    { _id: "m2", name: "Cold Coffee",   price: 90,  isAvailable: true },
    { _id: "m3", name: "Sold Out Item", price: 50,  isAvailable: false },
  ];
  const MenuItem = { findById: async (id) => catalog.find((c) => c._id === id) || null };

  await test("priceItems resolves price/name from the DB catalog, ignoring any client-sent price", async () => {
    const items = await priceItems(
      [{ menuItemId: "m1", qty: 2, price: 1 /* attacker-supplied, must be ignored */ }],
      MenuItem
    );
    assert.equal(items[0].price, 220); // NOT 1
    assert.equal(items[0].name, "Paneer Tikka");
    assert.equal(items[0].qty, 2);
  });

  await test("priceItems rejects an unavailable item", async () => {
    await assert.rejects(() => priceItems([{ menuItemId: "m3", qty: 1 }], MenuItem), /not available/);
  });

  await test("priceItems rejects a non-existent item", async () => {
    await assert.rejects(() => priceItems([{ menuItemId: "nope", qty: 1 }], MenuItem), /not found/i);
  });

  await test("priceItems rejects zero/negative/non-integer quantities", async () => {
    await assert.rejects(() => priceItems([{ menuItemId: "m1", qty: 0 }], MenuItem), /Invalid quantity/);
    await assert.rejects(() => priceItems([{ menuItemId: "m1", qty: -1 }], MenuItem), /Invalid quantity/);
    await assert.rejects(() => priceItems([{ menuItemId: "m1", qty: 1.5 }], MenuItem), /Invalid quantity/);
  });

  await test("priceItems rejects an empty items array", async () => {
    await assert.rejects(() => priceItems([], MenuItem), /No items/);
  });

  await test("priceOrder composes priceItems + computeTotals end-to-end", async () => {
    const result = await priceOrder({
      items: [{ menuItemId: "m1", qty: 1 }, { menuItemId: "m2", qty: 2 }],
      MenuItem,
      restaurantProfile: { gstRate: 0, serviceCharge: 0 },
    });
    assert.equal(result.subtotal, 220 + 90 * 2); // 400
    assert.equal(result.total, 400);
    assert.equal(result.dbItems.length, 2);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("ALL TESTS PASSED");
};

run();
