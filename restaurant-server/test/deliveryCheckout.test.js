// test/deliveryCheckout.test.js — placeOrderTx for home delivery (orderType
// ONLINE) under the delivery payment policy: COD by default and independent
// of PhonePe; Online only when the admin enabled it AND PhonePe is configured;
// every method off → a clear refusal. Dine-in / takeaway unchanged.
// Plain Node, fake models.  Run: node test/deliveryCheckout.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.PHONEPE_MERCHANT_ID;
delete process.env.PHONEPE_SALT_KEY;

const { placeOrderTx } = await import("../services/orderService.js");
const { deliveryPaymentOptions, resolveDeliveryPaymentMethod, parseSettingsPatch } = await import("../utils/delivery.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const MENU = [{ _id: "m1", name: "Momo", price: 120, isAvailable: true }];
const BASE = {
  restaurantName: "Zen", gstRate: 0, serviceCharge: 0, latitude: 22.5726, longitude: 88.3639, deliveryRange: 5000,
  paymentMode: "ONLINE", // dine-in/takeaway policy — must NOT affect delivery
  services: { dineIn: true, takeAway: true, delivery: true },
};
const profileWith = (payment) => ({ ...BASE, delivery: payment ? { payment } : undefined });

const makeReq = ({ role = "customer", profile = profileWith() } = {}) => {
  const created = [];
  const models = {
    MenuItem: { findById: async (id) => MENU.find((m) => m._id === id) || null },
    RestaurantProfile: { findOne: async () => profile },
    Category: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    Recipe: { find: async () => [] },
    InventoryItem: {},
    Table: { findOne: async () => null },
    TableSession: { findByIdAndUpdate: async () => ({}) },
    KOTJob: {},
    Order: {
      findOne: async () => null,
      create: async (doc) => { const o = { _id: "o1", ...doc }; created.push(o); return o; },
    },
  };
  return { req: { models, db: {}, user: { _id: "u1", role, name: "Asha" } }, created };
};

const delivery = { address: "12 Park Street, Kolkata", latitude: 22.5530, longitude: 88.3520, contactName: "Asha", contactPhone: "9876543210" };
const body = (extra) => ({ items: [{ menuItemId: "m1", qty: 1 }], orderType: "ONLINE", delivery, ...extra });
const withPhonePe = async (fn) => {
  process.env.PHONEPE_MERCHANT_ID = "M1"; process.env.PHONEPE_SALT_KEY = "k";
  try { await fn(); } finally { delete process.env.PHONEPE_MERCHANT_ID; delete process.env.PHONEPE_SALT_KEY; }
};

console.log("── policy (pure) ──");
await test("defaults: COD on, Online off, COD is the default", () => {
  const o = deliveryPaymentOptions({ profile: profileWith(), phonePeEnabled: true });
  assert.deepEqual(o.methods, ["Cash"]);
  assert.equal(o.defaultMethod, "Cash");
  assert.equal(o.available, true);
});
await test("Online appears only when enabled AND PhonePe is configured; default honoured", () => {
  const p = profileWith({ codEnabled: true, onlineEnabled: true, defaultMethod: "ONLINE" });
  assert.deepEqual(deliveryPaymentOptions({ profile: p, phonePeEnabled: false }).methods, ["Cash"]);
  const on = deliveryPaymentOptions({ profile: p, phonePeEnabled: true });
  assert.deepEqual(on.methods, ["Cash", "Online"]);
  assert.equal(on.defaultMethod, "Online");
});
await test("everything off → unavailable with an explanation", () => {
  const o = deliveryPaymentOptions({ profile: profileWith({ codEnabled: false, onlineEnabled: true }), phonePeEnabled: false });
  assert.equal(o.available, false);
  assert.match(o.unavailableReason, /Cash on Delivery is turned off/);
  assert.throws(() => resolveDeliveryPaymentMethod({ requested: "Cash", options: o }), (e) => e.code === "DELIVERY_PAYMENT_UNAVAILABLE");
});
await test("settings patch validates payment keys", () => {
  assert.deepEqual(parseSettingsPatch({ payment: { codEnabled: false, defaultMethod: "ONLINE" } }), { payment: { codEnabled: false, defaultMethod: "ONLINE" } });
  assert.throws(() => parseSettingsPatch({ payment: { codEnabled: "yes" } }), /true or false/);
  assert.throws(() => parseSettingsPatch({ payment: { defaultMethod: "UPI" } }), /COD, ONLINE/);
  assert.throws(() => parseSettingsPatch({ payment: { gateway: "x" } }), /Unknown payment setting/);
});

console.log("── placeOrderTx ──");
await test("COD by default, with NO PhonePe configured → normal customer order (awaits staff)", async () => {
  const { req, created } = makeReq();
  const { order } = await placeOrderTx({ req, body: body({}) });
  assert.equal(order.paymentMethod, "Cash");
  assert.equal(order.status, "PENDING_CONFIRMATION");
  assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
  assert.equal(order.deliveryAddress.contactPhone, "9876543210");
  assert.equal(created.length, 1);
});
await test("restaurant paymentMode ONLINE (dine-in/takeaway rule) does not block delivery COD", async () => {
  const { req } = makeReq({ profile: { ...profileWith(), paymentMode: "ONLINE" } });
  await withPhonePe(async () => {
    const { order } = await placeOrderTx({ req, body: body({ paymentMethod: "Cash" }) });
    assert.equal(order.paymentMethod, "Cash");
  });
});
await test("Online for delivery while the admin hasn't enabled it → refused", async () => {
  await withPhonePe(async () => {
    const { req } = makeReq();
    await assert.rejects(() => placeOrderTx({ req, body: body({ paymentMethod: "Online" }) }), (e) => e.code === "DELIVERY_PAYMENT_METHOD");
  });
});
await test("Online enabled + PhonePe → pay-first (AWAITING_PAYMENT)", async () => {
  await withPhonePe(async () => {
    const { req } = makeReq({ profile: profileWith({ codEnabled: true, onlineEnabled: true }) });
    const { order } = await placeOrderTx({ req, body: body({ paymentMethod: "Online" }) });
    assert.equal(order.status, "AWAITING_PAYMENT");
  });
});
await test("COD off and Online not configured → delivery refused with the reason", async () => {
  const { req, created } = makeReq({ profile: profileWith({ codEnabled: false, onlineEnabled: true }) });
  await assert.rejects(() => placeOrderTx({ req, body: body({}) }), (e) => e.code === "DELIVERY_PAYMENT_UNAVAILABLE" && /unavailable/.test(e.message));
  assert.equal(created.length, 0);
});
await test("address outside the range → 403, nothing created", async () => {
  const { req, created } = makeReq();
  await assert.rejects(() => placeOrderTx({ req, body: body({ delivery: { ...delivery, latitude: 22.9 } }) }), (e) => e.statusCode === 403);
  assert.equal(created.length, 0);
});
await test("delivery service switched off → refused (existing SET-01 toggle)", async () => {
  const { req } = makeReq({ profile: { ...profileWith(), services: { dineIn: true, takeAway: true, delivery: false } } });
  await assert.rejects(() => placeOrderTx({ req, body: body({}) }));
});
await test("a delivery partner account cannot place orders", async () => {
  const { req } = makeReq({ role: "delivery" });
  await assert.rejects(() => placeOrderTx({ req, body: body({}) }), (e) => e.statusCode === 403);
});
await test("takeaway is unchanged: still governed by paymentMode (ONLINE without PhonePe → Cash)", async () => {
  const { req } = makeReq({ profile: { ...profileWith({ codEnabled: false }), paymentMode: "CASH" } });
  const { order } = await placeOrderTx({ req, body: { items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY", paymentMethod: "Cash" } });
  assert.equal(order.status, "PENDING_CONFIRMATION");
  assert.equal(order.deliveryAddress, null);
  await assert.rejects(() => placeOrderTx({ req, body: { items: [{ menuItemId: "m1", qty: 1 }], orderType: "TAKEAWAY", paymentMethod: "Online" } }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
