// test/deliveryRoute.test.js — services/routeService.js with a fake HTTP client
// (never calls Google). Run: node test/deliveryRoute.test.js
import assert from "node:assert/strict";

const { planRiderRoute } = await import("../services/routeService.js");
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack || err.message}`); }
};

const R = { latitude: 22.55, longitude: 88.35, name: "Zen Cafe" };
const job = (id, status, lat) => ({ _id: id, orderNo: `O${id}`, status, pickup: R, drop: { latitude: lat, longitude: 88.36 } });
const models = (jobs, loc = { latitude: 22.56, longitude: 88.36 }) => ({
  DeliveryPartnerState: { findOne: () => ({ select: () => ({ lean: async () => ({ lastLocation: loc }) }) }) },
  DeliveryJob: { find: () => ({ sort: () => ({ lean: async () => jobs }) }) },
});
const user = { _id: "u1" };

await test("no key → available:false with stops (pickup first), and no ETA", async () => {
  delete process.env.GOOGLE_ROUTES_API_KEY;
  const r = await planRiderRoute({ models: models([job("a", "ASSIGNED", 22.54), job("b", "PICKED_UP", 22.53)]), user });
  assert.equal(r.available, false);
  assert.equal(r.reason, "ROUTES_NOT_CONFIGURED");
  assert.equal(r.stops[0].kind, "PICKUP");
  assert.deepEqual(r.stops[0].jobIds, ["a"]);
  assert.equal(r.totalDurationSec, undefined);
});

await test("with a key: pickup stays first (no optimisation), legs mapped to stops", async () => {
  process.env.GOOGLE_ROUTES_API_KEY = "k";
  let sent;
  const http = { post: async (_u, body) => { sent = body; return { data: { routes: [{ duration: "900s", distanceMeters: 4200, legs: [{ duration: "300s", distanceMeters: 1000 }, { duration: "600s", distanceMeters: 3200 }] }] } }; } };
  const r = await planRiderRoute({ models: models([job("a", "ASSIGNED", 22.54)]), user, http });
  assert.equal(sent.optimizeWaypointOrder, false);
  assert.equal(r.available, true);
  assert.deepEqual(r.stops.map((s) => s.kind), ["PICKUP", "DROP"]);
  assert.equal(r.totalDurationSec, 900);
  assert.equal(r.stops[1].legDurationSec, 600);
});

await test("all picked up: drops optimised by Google's order", async () => {
  process.env.GOOGLE_ROUTES_API_KEY = "k";
  const http = { post: async (_u, body) => { assert.equal(body.optimizeWaypointOrder, true); return { data: { routes: [{ duration: "1200s", optimizedIntermediateWaypointIndex: [1, 0], legs: [] }] } }; } };
  const r = await planRiderRoute({ models: models([job("a", "PICKED_UP", 22.54), job("b", "PICKED_UP", 22.53), job("c", "PICKED_UP", 22.52)]), user, http });
  assert.deepEqual(r.stops.map((s) => s.jobIds[0]), ["b", "a", "c"]);
});

await test("Google error → available:false, never a made-up ETA", async () => {
  process.env.GOOGLE_ROUTES_API_KEY = "k";
  const r = await planRiderRoute({ models: models([job("a", "PICKED_UP", 22.54)]), user, http: { post: async () => { throw new Error("403"); } } });
  assert.equal(r.available, false);
  assert.equal(r.reason, "ROUTES_API_ERROR");
  delete process.env.GOOGLE_ROUTES_API_KEY;
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
