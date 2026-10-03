// test/couponOffer.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Coupon announcements (services/couponOfferService.js): a coupon for
// registered customers can be pushed as an offer — scheduled for its start
// date, cancelled if the coupon changes before then, never sent for a
// guest-only coupon. No DB and no real Firebase (same stubbing as
// offerNotifications.test.js). Run with:
//   node test/couponOffer.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" });

const { default: admin } = await import("../utils/firebaseAdmin.js");
const {
  createCouponWithNotice, updateCouponWithNotice, deleteCouponWithNotice, couponPushBody,
} = await import("../services/couponOfferService.js");

let sent = [];
Object.defineProperty(admin, "messaging", {
  configurable: true,
  value: () => ({ send: async (msg) => { sent.push(msg); return "id"; } }),
});

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

// ── Minimal in-memory collections ───────────────────────────────────────────
let nextId = 1;
const clone = (d) => (d ? { ...d } : null);
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
const collection = () => {
  const rows = [];
  const byId = (id) => rows.find((r) => String(r._id) === String(id));
  return {
    rows,
    byId,
    create: async (data) => { const d = { _id: `id${nextId++}`, ...data }; rows.push(d); return clone(d); },
    updateOne: async (f, { $set }) => { const d = rows.find((r) => matches(r, f)); if (d) Object.assign(d, $set); },
    findOneAndUpdate: async (f, { $set }) => { const d = rows.find((r) => matches(r, f)); if (!d) return null; Object.assign(d, $set); return clone(d); },
    findByIdAndUpdate: async (id, { $set }) => { const d = byId(id); Object.assign(d, $set); return clone(d); },
    findByIdAndDelete: async (id) => { const d = byId(id); if (d) rows.splice(rows.indexOf(d), 1); return clone(d); },
    deleteOne: async (f) => { const d = rows.find((r) => matches(r, f)); if (d) rows.splice(rows.indexOf(d), 1); },
    exists: async (f) => rows.some((r) => matches(r, f)),
  };
};

const makeModels = () => {
  const NotificationLog = collection();
  const Coupon = collection();
  // findById(...)[.select(..)][.populate(..)].lean()
  const finder = (col, populate) => (id) => {
    let pop = false;
    const q = {
      select: () => q,
      populate: () => { pop = true; return q; },
      lean: async () => {
        const d = clone(col.byId(id));
        if (d && pop && populate && d.notification) d.notification = clone(populate.byId(d.notification));
        return d;
      },
    };
    return q;
  };
  NotificationLog.findById = finder(NotificationLog);
  Coupon.findById = finder(Coupon, NotificationLog);
  return {
    Coupon, NotificationLog,
    User: { countDocuments: async () => 3 },
    RestaurantProfile: { findOne: () => ({ select: () => ({ lean: async () => ({}) }) }) },
  };
};

const NOW = new Date(2026, 9, 5, 12);        // 5 Oct 2026
const day = (d, h = 0) => new Date(2026, 9, d, h);
const body = (over = {}) => ({
  code: "PUJA20", title: "Puja offer", description: "Celebrate with us", discountType: "PERCENT", discountValue: 20,
  startsAt: day(10).toISOString(), endsAt: day(15, 23).toISOString(), audience: "REGISTERED", notify: true, ...over,
});
const actor = { id: null, role: "ADMIN", name: "Admin" };

await test("registered coupon + notify → offer SCHEDULED for the coupon's start date", async () => {
  sent = [];
  const models = makeModels();
  const { coupon, warning } = await createCouponWithNotice({ models, body: body(), actor, now: NOW });
  assert.equal(warning, "");
  assert.equal(coupon.notification.status, "SCHEDULED");
  const log = models.NotificationLog.rows[0];
  assert.equal(log.couponCode, "PUJA20");
  assert.equal(new Date(log.startsAt).getTime(), day(10).getTime());
  assert.equal(new Date(log.expiresAt).getTime(), day(15, 23).getTime());
  assert.equal(sent.length, 0); // not pushed yet — the scheduler does that on 10 Oct
});

await test("a coupon that has already started is pushed right away", async () => {
  sent = [];
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body({ startsAt: day(1).toISOString() }), actor, now: NOW });
  assert.equal(coupon.notification.status, "SENT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.couponCode, "PUJA20");
});

await test("a new guest-only coupon is refused (guests can't apply coupons) — nothing announced", async () => {
  sent = [];
  const models = makeModels();
  await assert.rejects(
    createCouponWithNotice({ models, body: body({ audience: "GUEST" }), actor, now: NOW }),
    /Guests can't use coupons/,
  );
  assert.equal(models.NotificationLog.rows.length, 0);
  assert.equal(sent.length, 0);
});

await test("notify unticked → no notification", async () => {
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body({ notify: false }), actor, now: NOW });
  assert.ok(!coupon.notification); // fake has no schema default (null)
});

await test("editing the dates re-schedules: old pending push cancelled, new one created", async () => {
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body(), actor, now: NOW });
  const oldId = coupon.notification._id;
  const { coupon: edited } = await updateCouponWithNotice({ models, id: coupon._id, body: { startsAt: day(12).toISOString() }, actor, now: NOW });
  assert.equal(models.NotificationLog.byId(oldId).status, "CANCELLED");
  assert.notEqual(String(edited.notification._id), String(oldId));
  assert.equal(new Date(edited.notification.startsAt).getTime(), day(12).getTime());
});

await test("pause cancels the pending push; resume schedules it again", async () => {
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body(), actor, now: NOW });
  const first = coupon.notification._id;
  const paused = await updateCouponWithNotice({ models, id: coupon._id, body: { isActive: false }, actor, now: NOW });
  assert.equal(paused.coupon.notification, null);
  assert.equal(models.NotificationLog.byId(first).status, "CANCELLED");
  const resumed = await updateCouponWithNotice({ models, id: coupon._id, body: { isActive: true }, actor, now: NOW });
  assert.equal(resumed.coupon.notification.status, "SCHEDULED");
});

await test("an already-sent push is never re-sent on edit", async () => {
  sent = [];
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body({ startsAt: day(1).toISOString() }), actor, now: NOW });
  await updateCouponWithNotice({ models, id: coupon._id, body: { title: "Puja offer — extended" }, actor, now: NOW });
  assert.equal(sent.length, 1);
  assert.equal(models.NotificationLog.rows.length, 1);
});

await test("deleting a coupon cancels its scheduled push", async () => {
  const models = makeModels();
  const { coupon } = await createCouponWithNotice({ models, body: body(), actor, now: NOW });
  await deleteCouponWithNotice({ models, id: coupon._id });
  assert.equal(models.NotificationLog.rows[0].status, "CANCELLED");
});

await test("push body stays within the 200-character limit", () => {
  const b = couponPushBody({ code: "X12", description: "a".repeat(200), discountType: "FLAT", discountValue: 50, minOrderAmount: 300 });
  assert.ok(b.length <= 200, `length ${b.length}`);
  assert.match(b, /Use code X12/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
