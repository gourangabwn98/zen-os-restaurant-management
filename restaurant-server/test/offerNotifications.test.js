// test/offerNotifications.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Offer broadcasts with coupon codes + the customer notification history
// (services/notificationService.js). No DB and no real Firebase: fake models,
// a throwaway service-account key, and a stubbed admin.messaging(). Run with:
//   node test/offerNotifications.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

// firebase-admin initializes at import time — give it a dummy credential.
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" });

const { default: admin } = await import("../utils/firebaseAdmin.js");
const {
  normalizeCouponCode, sendOfferBroadcast, listCustomerNotifications, OFFERS_TOPIC,
} = await import("../services/notificationService.js");

let sent = [];
let failNextSend = false;
// `messaging` is a prototype getter on the Firebase namespace — shadow it
// with an own property so the service's admin.messaging().send() hits the stub.
Object.defineProperty(admin, "messaging", {
  configurable: true,
  value: () => ({
    send: async (msg) => { if (failNextSend) { failNextSend = false; throw new Error("fcm down"); } sent.push(msg); return "id"; },
  }),
});

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

const fakeModels = ({ logs = [], user = {}, logo = "" } = {}) => {
  const store = [...logs];
  const chain = (rows) => ({ sort: () => chain(rows), limit: (n) => chain(rows.slice(0, n)), select: () => chain(rows), lean: async () => rows });
  return {
    store,
    User: {
      countDocuments: async () => 7,
      findById: () => ({ select: () => ({ lean: async () => user }) }),
    },
    RestaurantProfile: { findOne: () => ({ select: () => ({ lean: async () => ({ logo }) }) }) },
    NotificationLog: {
      create: async (doc) => { const row = { _id: `log${store.length + 1}`, createdAt: new Date(), ...doc }; store.push(row); return row; },
      deleteOne: async ({ _id }) => { const i = store.findIndex((r) => r._id === _id); if (i >= 0) store.splice(i, 1); },
      find: () => chain([...store].sort((a, b) => b.createdAt - a.createdAt)),
    },
  };
};
const actor = { id: null, role: "ADMIN", name: "Owner" };

await test("coupon code: trimmed + uppercased, empty means none", () => {
  assert.equal(normalizeCouponCode("  diwali20 "), "DIWALI20");
  assert.equal(normalizeCouponCode("new-year_25"), "NEW-YEAR_25");
  assert.equal(normalizeCouponCode(""), "");
  assert.equal(normalizeCouponCode(undefined), "");
});

await test("coupon code: malformed codes are rejected with 400", () => {
  for (const bad of ["AB", "HAS SPACE", "EMOJI🎉", "X".repeat(21), "50%OFF"]) {
    assert.throws(() => normalizeCouponCode(bad), (e) => e.statusCode === 400, bad);
  }
});

await test("broadcast: data-only, high-urgency web push to the offers topic, coupon + id included", async () => {
  sent = [];
  const models = fakeModels({ logo: "https://cdn.example.com/logo.png" });
  const log = await sendOfferBroadcast({ models, title: " 20% off ", body: "This weekend only", couponCode: "weekend20", actor });
  assert.equal(log.couponCode, "WEEKEND20");
  assert.equal(log.recipientCount, 7);
  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.equal(msg.topic, OFFERS_TOPIC);
  assert.equal(msg.notification, undefined, "no notification block → the service worker owns display (no duplicates)");
  assert.deepEqual(msg.data, {
    id: String(log._id), title: "20% off", body: "This weekend only", couponCode: "WEEKEND20",
    icon: "https://cdn.example.com/logo.png", url: "/notifications",
  });
  for (const v of Object.values(msg.data)) assert.equal(typeof v, "string", "FCM data values must be strings");
  assert.equal(msg.webpush.headers.Urgency, "high");
});

await test("broadcast: a non-URL logo (e.g. emoji) is not sent as the icon", async () => {
  sent = [];
  await sendOfferBroadcast({ models: fakeModels({ logo: "🍔" }), title: "T", body: "B", actor });
  assert.equal(sent[0].data.icon, "");
  assert.equal(sent[0].data.couponCode, "");
});

await test("broadcast: bad coupon rejects before anything is logged or sent", async () => {
  sent = [];
  const models = fakeModels();
  await assert.rejects(sendOfferBroadcast({ models, title: "T", body: "B", couponCode: "no spaces", actor }), (e) => e.statusCode === 400);
  assert.equal(sent.length, 0);
  assert.equal(models.store.length, 0);
});

await test("broadcast: if FCM fails, the log row is removed and a 502 is returned", async () => {
  const models = fakeModels();
  failNextSend = true;
  await assert.rejects(sendOfferBroadcast({ models, title: "T", body: "B", actor }), (e) => e.statusCode === 502);
  assert.equal(models.store.length, 0);
});

await test("history: newest first, unread = newer than last seen", async () => {
  const t = (m) => new Date(Date.UTC(2026, 8, 1, 10, m));
  const logs = [
    { _id: "a", title: "Old", body: "b", couponCode: "", createdAt: t(0), sentBy: actor, recipientCount: 3 },
    { _id: "b", title: "New 1", body: "b", couponCode: "X123", createdAt: t(20), sentBy: actor, recipientCount: 3 },
    { _id: "c", title: "New 2", body: "b", couponCode: "", createdAt: t(30), sentBy: actor, recipientCount: 3 },
  ];
  const res = await listCustomerNotifications({ models: fakeModels({ logs, user: { notificationsSeenAt: t(10), createdAt: t(0) } }), userId: "u" });
  assert.deepEqual(res.notifications.map((n) => n.title), ["New 2", "New 1", "Old"]);
  assert.equal(res.unreadCount, 2);
});

await test("history: never opened → only offers since the account was created are unread", async () => {
  const t = (m) => new Date(Date.UTC(2026, 8, 1, 10, m));
  const logs = [
    { _id: "a", title: "Before signup", body: "b", createdAt: t(0) },
    { _id: "b", title: "After signup", body: "b", createdAt: t(20) },
  ];
  const res = await listCustomerNotifications({ models: fakeModels({ logs, user: { notificationsSeenAt: null, createdAt: t(10) } }), userId: "u" });
  assert.equal(res.unreadCount, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
