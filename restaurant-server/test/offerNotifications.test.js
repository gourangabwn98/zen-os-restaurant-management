// test/offerNotifications.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Offer broadcasts (services/notificationService.js): coupon codes, offer
// timing (start / expiry), the scheduled-send tick, cancel, and the customer
// notification history. No DB and no real Firebase: an in-memory fake
// NotificationLog, a throwaway service-account key, and a stubbed
// admin.messaging(). Run with:
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
  normalizeCouponCode, normalizeOfferTiming, sendOfferBroadcast, runDueOffers,
  cancelScheduledOffer, listCustomerNotifications, OFFERS_TOPIC,
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

// ── Tiny in-memory Mongo stand-in (only the operators the service uses) ─────
const val = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
  const v = doc[k];
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === "$lte") return v != null && val(v) <= val(x);
      if (op === "$lt")  return v != null && val(v) <  val(x);
      if (op === "$ne")  return val(v) !== val(x);
      if (op === "$exists") return (v !== undefined) === x;
      throw new Error(`fake: unsupported ${op}`);
    });
  }
  return val(v) === val(cond);
});
const sorter = (spec = {}) => (a, b) => {
  for (const [k, dir] of Object.entries(spec)) { const d = (val(a[k]) ?? 0) - (val(b[k]) ?? 0); if (d) return d * dir; }
  return 0;
};
const applyUpdate = (doc, update) => {
  if (Array.isArray(update)) { // aggregation-pipeline update: only {$set: {f: "$other"}}
    for (const stage of update) for (const [k, v] of Object.entries(stage.$set)) doc[k] = typeof v === "string" && v.startsWith("$") ? doc[v.slice(1)] : v;
  } else Object.assign(doc, update.$set);
};

const fakeModels = ({ logs = [], user = {}, logo = "" } = {}) => {
  const store = logs.map((l) => ({ ...l }));
  let n = 0;
  const query = (rows) => {
    const q = { sort: (s) => query([...rows].sort(sorter(s))), limit: (k) => query(rows.slice(0, k)), select: () => q, lean: async () => rows.map((r) => ({ ...r })) };
    return q;
  };
  return {
    store,
    User: {
      countDocuments: async () => 7,
      findById: () => ({ select: () => ({ lean: async () => user }) }),
    },
    RestaurantProfile: { findOne: () => ({ select: () => ({ lean: async () => ({ logo }) }) }) },
    NotificationLog: {
      create: async (doc) => { const row = { _id: `log${++n}`, createdAt: new Date(), ...doc }; store.push(row); return { ...row }; },
      deleteOne: async ({ _id }) => { const i = store.findIndex((r) => r._id === _id); if (i >= 0) store.splice(i, 1); },
      exists: async (f) => store.some((r) => matches(r, f)),
      find: (f = {}) => query(store.filter((r) => matches(r, f))),
      findOneAndUpdate: async (f, u, opts = {}) => {
        const row = store.filter((r) => matches(r, f)).sort(sorter(opts.sort))[0];
        if (!row) return null;
        applyUpdate(row, u);
        return { ...row };
      },
      updateOne: async (f, u) => { const row = store.find((r) => matches(r, f)); if (row) applyUpdate(row, u); return { modifiedCount: row ? 1 : 0 }; },
      updateMany: async (f, u) => { const rows = store.filter((r) => matches(r, f)); rows.forEach((r) => applyUpdate(r, u)); return { modifiedCount: rows.length }; },
    },
  };
};
const actor = { id: null, role: "ADMIN", name: "Owner" };
const NOW = new Date(Date.UTC(2026, 8, 1, 10, 0));
const at = (min) => new Date(NOW.getTime() + min * 60 * 1000);

// ── Coupon code ──────────────────────────────────────────────────────────────
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

// ── Timing ───────────────────────────────────────────────────────────────────
await test("timing: blank / past / within a minute start = send now", () => {
  assert.equal(normalizeOfferTiming({ now: NOW }).startsAt, null);
  assert.equal(normalizeOfferTiming({ startsAt: at(-30).toISOString(), now: NOW }).startsAt, null);
  assert.equal(normalizeOfferTiming({ startsAt: at(0.5).toISOString(), now: NOW }).startsAt, null);
  assert.equal(normalizeOfferTiming({ startsAt: at(5).toISOString(), now: NOW }).startsAt.getTime(), at(5).getTime());
});

await test("timing: invalid windows are rejected with 400", () => {
  const bad = [
    { startsAt: "not a date" },
    { expiresAt: at(-1).toISOString() },                                  // already expired
    { startsAt: at(60).toISOString(), expiresAt: at(30).toISOString() },  // ends before it starts
    { startsAt: new Date(NOW.getTime() + 400 * 864e5).toISOString() },    // > a year ahead
  ];
  for (const b of bad) assert.throws(() => normalizeOfferTiming({ ...b, now: NOW }), (e) => e.statusCode === 400, JSON.stringify(b));
});

// ── Send now ─────────────────────────────────────────────────────────────────
await test("send now: data-only, high-urgency push to the offers topic, marked SENT", async () => {
  sent = [];
  const models = fakeModels({ logo: "https://cdn.example.com/logo.png" });
  const log = await sendOfferBroadcast({
    models, title: " 20% off ", body: "This weekend only", couponCode: "weekend20",
    expiresAt: at(120).toISOString(), actor, now: NOW,
  });
  assert.equal(log.status, "SENT");
  assert.equal(log.couponCode, "WEEKEND20");
  assert.equal(log.recipientCount, 7);
  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.equal(msg.topic, OFFERS_TOPIC);
  assert.equal(msg.notification, undefined, "no notification block → the service worker owns display (no duplicates)");
  assert.deepEqual(msg.data, {
    id: String(log._id), title: "20% off", body: "This weekend only", couponCode: "WEEKEND20",
    expiresAt: at(120).toISOString(), icon: "https://cdn.example.com/logo.png", url: "/notifications",
  });
  for (const v of Object.values(msg.data)) assert.equal(typeof v, "string", "FCM data values must be strings");
  assert.equal(msg.webpush.headers.Urgency, "high");
  assert.equal(msg.webpush.headers.TTL, String(120 * 60), "TTL stops at the offer's expiry");
});

await test("send now: without expiry the TTL is capped at a day; emoji logo isn't used as icon", async () => {
  sent = [];
  await sendOfferBroadcast({ models: fakeModels({ logo: "🍔" }), title: "T", body: "B", actor, now: NOW });
  assert.equal(sent[0].data.icon, "");
  assert.equal(sent[0].data.expiresAt, "");
  assert.equal(sent[0].webpush.headers.TTL, String(24 * 60 * 60));
});

await test("send now: bad coupon rejects before anything is logged or sent", async () => {
  sent = [];
  const models = fakeModels();
  await assert.rejects(sendOfferBroadcast({ models, title: "T", body: "B", couponCode: "no spaces", actor, now: NOW }), (e) => e.statusCode === 400);
  assert.equal(sent.length, 0);
  assert.equal(models.store.length, 0);
});

await test("send now: if FCM fails, the log row is removed and a 502 is returned", async () => {
  const models = fakeModels();
  failNextSend = true;
  await assert.rejects(sendOfferBroadcast({ models, title: "T", body: "B", actor, now: NOW }), (e) => e.statusCode === 502);
  assert.equal(models.store.length, 0);
});

// ── Scheduled ────────────────────────────────────────────────────────────────
await test("scheduled: future start is stored SCHEDULED and nothing is pushed yet", async () => {
  sent = [];
  const models = fakeModels();
  const log = await sendOfferBroadcast({ models, title: "Lunch deal", body: "B", couponCode: "LUNCH", startsAt: at(60).toISOString(), actor, now: NOW });
  assert.equal(log.status, "SCHEDULED");
  assert.equal(sent.length, 0);
  const early = await runDueOffers({ models, now: at(59) });
  assert.equal(early.sent, 0);
  assert.equal(sent.length, 0);
});

await test("scheduled: tick at/after start pushes it exactly once", async () => {
  sent = [];
  const models = fakeModels();
  await sendOfferBroadcast({ models, title: "Lunch deal", body: "B", couponCode: "LUNCH", startsAt: at(60).toISOString(), actor, now: NOW });
  const r1 = await runDueOffers({ models, now: at(60) });
  const r2 = await runDueOffers({ models, now: at(61) });
  const [r3, r4] = await Promise.all([runDueOffers({ models, now: at(62) }), runDueOffers({ models, now: at(62) })]);
  assert.equal(r1.sent, 1);
  assert.equal(r2.sent + r3.sent + r4.sent, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.couponCode, "LUNCH");
  assert.equal(models.store[0].status, "SENT");
  assert.equal(models.store[0].sentAt.getTime(), at(60).getTime());
});

await test("scheduled: expired before the server got to it → FAILED, not pushed", async () => {
  sent = [];
  const models = fakeModels();
  await sendOfferBroadcast({ models, title: "T", body: "B", startsAt: at(10).toISOString(), expiresAt: at(20).toISOString(), actor, now: NOW });
  const r = await runDueOffers({ models, now: at(30) }); // server was down 10→30
  assert.equal(r.failed, 1);
  assert.equal(sent.length, 0);
  assert.equal(models.store[0].status, "FAILED");
});

await test("scheduled: FCM error marks it FAILED with a reason (no retry loop)", async () => {
  sent = [];
  const models = fakeModels();
  await sendOfferBroadcast({ models, title: "T", body: "B", startsAt: at(10).toISOString(), actor, now: NOW });
  failNextSend = true;
  const r = await runDueOffers({ models, now: at(10) });
  assert.equal(r.failed, 1);
  assert.equal(models.store[0].status, "FAILED");
  assert.match(models.store[0].error, /fcm down/);
  await runDueOffers({ models, now: at(11) });
  assert.equal(sent.length, 0, "a FAILED offer is never retried automatically");
});

await test("scheduled: a claim stuck in SENDING (crash) becomes FAILED, never re-sent", async () => {
  sent = [];
  const models = fakeModels({ logs: [{ _id: "x", title: "T", body: "B", status: "SENDING", sendingAt: at(0), startsAt: at(0), createdAt: at(0) }] });
  const r = await runDueOffers({ models, now: at(11) });
  assert.equal(r.interrupted, 1);
  assert.equal(models.store[0].status, "FAILED");
  assert.equal(sent.length, 0);
});

await test("cancel: a scheduled offer can be cancelled; a sent one can't (409)", async () => {
  sent = [];
  const models = fakeModels();
  const log = await sendOfferBroadcast({ models, title: "T", body: "B", startsAt: at(60).toISOString(), actor, now: NOW });
  const c = await cancelScheduledOffer({ models, id: log._id });
  assert.equal(c.status, "CANCELLED");
  await runDueOffers({ models, now: at(90) });
  assert.equal(sent.length, 0, "cancelled offer is never pushed");
  await assert.rejects(cancelScheduledOffer({ models, id: log._id }), (e) => e.statusCode === 409);
  await assert.rejects(cancelScheduledOffer({ models, id: "missing" }), (e) => e.statusCode === 404);
});

await test("backfill: offers from before scheduling existed become SENT at their createdAt", async () => {
  const models = fakeModels({ logs: [{ _id: "old", title: "T", body: "B", createdAt: at(-100) }] });
  await runDueOffers({ models, now: NOW });
  assert.equal(models.store[0].status, "SENT");
  assert.equal(models.store[0].sentAt.getTime(), at(-100).getTime());
});

// ── Customer history ─────────────────────────────────────────────────────────
await test("history: only SENT offers, newest first; unread = sent after last seen", async () => {
  const logs = [
    { _id: "a", title: "Old", body: "b", status: "SENT", sentAt: at(0), createdAt: at(0) },
    { _id: "b", title: "New 1", body: "b", status: "SENT", sentAt: at(20), createdAt: at(20) },
    { _id: "c", title: "New 2", body: "b", status: "SENT", sentAt: at(30), createdAt: at(30) },
    { _id: "d", title: "Upcoming", body: "b", status: "SCHEDULED", startsAt: at(90), createdAt: at(25) },
    { _id: "e", title: "Cancelled", body: "b", status: "CANCELLED", createdAt: at(26) },
    { _id: "f", title: "Failed", body: "b", status: "FAILED", createdAt: at(27) },
  ];
  const res = await listCustomerNotifications({ models: fakeModels({ logs, user: { notificationsSeenAt: at(10), createdAt: at(0) } }), userId: "u", now: at(40) });
  assert.deepEqual(res.notifications.map((n) => n.title), ["New 2", "New 1", "Old"]);
  assert.equal(res.unreadCount, 2);
  assert.equal(res.serverNow.getTime(), at(40).getTime());
});

await test("history: never opened → only offers since the account was created are unread", async () => {
  const logs = [
    { _id: "a", title: "Before signup", body: "b", status: "SENT", sentAt: at(0) },
    { _id: "b", title: "After signup", body: "b", status: "SENT", sentAt: at(20) },
  ];
  const res = await listCustomerNotifications({ models: fakeModels({ logs, user: { notificationsSeenAt: null, createdAt: at(10) } }), userId: "u" });
  assert.equal(res.unreadCount, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
