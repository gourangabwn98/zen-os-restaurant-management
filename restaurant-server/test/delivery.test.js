// test/delivery.test.js — pure delivery helpers (utils/delivery.js,
// utils/deliveryStateMachine.js) + the order-state-machine hook for riders.
// Plain Node, no DB.  Run: node test/delivery.test.js
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const D = await import("../utils/delivery.js");
const SM = await import("../utils/deliveryStateMachine.js");
const { validateTransition } = await import("../utils/orderStateMachine.js");
const { EMPLOYEE_ROLES, employeeRolesFor, validateEmployeeInput } = await import("../services/employeeService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const PROFILE = { latitude: 22.5726, longitude: 88.3639, deliveryRange: 5000 };
const near = { address: "12 Park Street, Kolkata", latitude: 22.5530, longitude: 88.3520, contactPhone: "9876543210", contactName: "Asha" };

console.log("── checkout ──");
await test("valid address inside the range → snapshot with distance", () => {
  const a = D.parseDeliveryCheckout({ profile: PROFILE, delivery: near });
  assert.equal(a.contactPhone, "9876543210");
  assert.ok(a.distanceMeters > 2000 && a.distanceMeters < 3000, `distance ${a.distanceMeters}`);
});
await test("outside deliveryRange → 403 OUTSIDE_DELIVERY_RANGE", () => {
  assert.throws(() => D.parseDeliveryCheckout({ profile: PROFILE, delivery: { ...near, latitude: 22.80, longitude: 88.36 } }),
    (e) => e.statusCode === 403 && e.code === "OUTSIDE_DELIVERY_RANGE");
});
await test("missing pin / short address / bad phone are refused", () => {
  assert.throws(() => D.parseDeliveryCheckout({ profile: PROFILE, delivery: { ...near, latitude: undefined } }), (e) => e.code === "DELIVERY_LOCATION_REQUIRED");
  assert.throws(() => D.parseDeliveryCheckout({ profile: PROFILE, delivery: { ...near, address: "x" } }), (e) => e.code === "DELIVERY_ADDRESS_REQUIRED");
  assert.throws(() => D.parseDeliveryCheckout({ profile: PROFILE, delivery: { ...near, contactPhone: "12" } }), (e) => e.code === "DELIVERY_PHONE_REQUIRED");
  assert.throws(() => D.parseDeliveryCheckout({ profile: PROFILE, delivery: null }), (e) => e.code === "DELIVERY_ADDRESS_REQUIRED");
});
await test("restaurant location not set → 503, never 'deliver anywhere'", () => {
  assert.throws(() => D.parseDeliveryCheckout({ profile: { deliveryRange: 5000 }, delivery: near }), (e) => e.statusCode === 503);
});

console.log("── settings ──");
await test("defaults fill in and out-of-range values are clamped", () => {
  assert.deepEqual(D.deliverySettings(null), { ...D.DELIVERY_DEFAULTS });
  const s = D.deliverySettings({ delivery: { defaultCapacity: 99, offerTtlSeconds: 1 } });
  assert.equal(s.defaultCapacity, 10);
  assert.equal(s.offerTtlSeconds, 15);
});
await test("admin patch: unknown keys and non-integers are refused", () => {
  assert.deepEqual(D.parseSettingsPatch({ defaultCapacity: 4 }), { defaultCapacity: 4 });
  assert.throws(() => D.parseSettingsPatch({ capacity: 4 }), /Unknown/);
  assert.throws(() => D.parseSettingsPatch({ defaultCapacity: 2.5 }), /whole number/);
  assert.throws(() => D.parseSettingsPatch({ maxRounds: 0 }), /from 1/);
});
await test("capacityFor: rider override beats the default", () => {
  const s = D.deliverySettings({});
  assert.equal(D.capacityFor({ capacity: null }, s), 3);
  assert.equal(D.capacityFor({ capacity: 5 }, s), 5);
});

console.log("── OTP / tracking tokens ──");
await test("OTP is 4 digits and compares exactly", () => {
  for (let i = 0; i < 200; i++) assert.match(D.generateOtp(), /^\d{4}$/);
  assert.ok(D.otpMatches("0423", "0423"));
  assert.ok(D.otpMatches("0423", " 0423 "));
  assert.ok(!D.otpMatches("0423", "423"));
  assert.ok(!D.otpMatches("0423", "0424"));
  assert.ok(!D.otpMatches("", ""));
});
await test("tracking token round-trips; tampering is rejected", () => {
  const jobId = "64b7f0c2a1b2c3d4e5f60718";
  const t = D.signTrackingToken(jobId, 2);
  assert.deepEqual(D.parseTrackingToken(t), { jobId, version: 2 });
  const [id, v, sig] = t.split(".");
  assert.equal(D.parseTrackingToken(`${id}.3.${sig}`), null, "bumped version must not verify");
  assert.equal(D.parseTrackingToken(`64b7f0c2a1b2c3d4e5f60719.${v}.${sig}`), null, "other job must not verify");
  assert.equal(D.parseTrackingToken(`${id}.${v}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`), null);
  assert.equal(D.parseTrackingToken("nonsense"), null);
});
await test("tracking open while active; closes TTL hours after delivery; never when cancelled/revoked", () => {
  const s = D.deliverySettings({ delivery: { trackingTtlHours: 2 } });
  const now = new Date("2026-11-20T10:00:00Z");
  assert.ok(D.trackingOpen({ status: "PICKED_UP" }, s, now));
  assert.ok(D.trackingOpen({ status: "DELIVERED", deliveredAt: new Date("2026-11-20T08:30:00Z") }, s, now));
  assert.ok(!D.trackingOpen({ status: "DELIVERED", deliveredAt: new Date("2026-11-20T07:59:00Z") }, s, now));
  assert.ok(!D.trackingOpen({ status: "CANCELLED" }, s, now));
  assert.ok(!D.trackingOpen({ status: "ASSIGNED", trackingRevokedAt: now }, s, now));
});

console.log("── GPS validation ──");
await test("sorts, drops bad / future / stale / impossible-speed points", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const at = (s) => new Date(now.getTime() - s * 1000).toISOString();
  const { points, rejected } = D.sanitizeLocationBatch([
    { latitude: 22.5600, longitude: 88.3600, at: at(20) },
    { latitude: 22.5601, longitude: 88.3601, at: at(30) },          // older — sorted first
    { latitude: 95, longitude: 88, at: at(10) },                    // out of range
    { latitude: 22.56, longitude: 88.36, at: at(-600) },            // 10 min in the future
    { latitude: 22.56, longitude: 88.36, at: at(3 * 86400) },       // 3 days old
    { latitude: 22.56, longitude: 88.36, accuracy: 5000, at: at(5) }, // too inaccurate
    { latitude: 23.56, longitude: 88.36, at: at(15) },              // 110 km in 5 s
    { latitude: 0, longitude: 0, at: at(1) },                       // null island
  ], { now });
  assert.equal(points.length, 2);
  assert.ok(points[0].at < points[1].at);
  assert.equal(rejected, 6);
});
await test("more than 100 points is a 400, not a silent truncate", () => {
  assert.throws(() => D.sanitizeLocationBatch(new Array(101).fill({})), /At most 100/);
});

console.log("── state machines / roles ──");
await test("rider transitions: forward only, terminal is closed", () => {
  SM.assertRiderTransition("ASSIGNED", "AT_RESTAURANT");
  SM.assertRiderTransition("ASSIGNED", "PICKED_UP");
  SM.assertRiderTransition("PICKED_UP", "DELIVERED");
  assert.throws(() => SM.assertRiderTransition("ASSIGNED", "DELIVERED"), (e) => e.code === "BAD_TRANSITION");
  assert.throws(() => SM.assertRiderTransition("AT_RESTAURANT", "AT_CUSTOMER"), (e) => e.code === "BAD_TRANSITION");
  assert.throws(() => SM.assertRiderTransition("DELIVERED", "FAILED"), (e) => e.code === "JOB_CLOSED");
  assert.throws(() => SM.assertRiderTransition("SEARCHING", "PICKED_UP"), (e) => e.code === "BAD_TRANSITION");
});
await test("order state machine: a rider may ONLY do READY → DELIVERED", () => {
  assert.equal(validateTransition("READY", "DELIVERED", "delivery").ok, true);
  for (const [f, t] of [["CONFIRMED", "PREPARING"], ["PREPARING", "READY"], ["PENDING_CONFIRMATION", "CONFIRMED"], ["CONFIRMED", "CANCELLED"], ["DELIVERED", "COMPLETED"]]) {
    assert.equal(validateTransition(f, t, "delivery").ok, false, `${f}->${t}`);
  }
});
await test("employees: admin and manager can register a delivery partner; it needs no job title", () => {
  assert.ok(EMPLOYEE_ROLES.includes("delivery"));
  assert.ok(employeeRolesFor({ role: "manager" }).includes("delivery"));
  validateEmployeeInput({ name: "Ravi", phone: "9876500000", role: "delivery" });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
