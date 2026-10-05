// test/restaurantProfile.test.js — header details for BILL/KOT (src/restaurantProfile.js).
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { RestaurantProfileProvider } from "../src/restaurantProfile.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "profile-test-"));
const PROFILE = { restaurantName: "AD's Cafe", address: "12 Station Road", city: "Purba Burdwan", phone: "9999999999", logo: "https://x/l.jpg", upiId: "secret@upi" };
const okFetch = (calls) => async (url) => { calls?.push(url); return { ok: true, json: async () => ({ success: true, data: PROFILE }) }; };
const down = async () => { throw new Error("offline"); };

await test("reads name/address/city/phone/logo from the public profile endpoint", async () => {
  const calls = [];
  const p = await new RestaurantProfileProvider({ backendUrl: "https://api.example.com/", cacheDir: dir(), fetch: okFetch(calls) }).get();
  assert.equal(calls[0], "https://api.example.com/api/admin/restaurant/profile");
  assert.deepEqual(p, { name: "AD's Cafe", address: "12 Station Road", city: "Purba Burdwan", phone: "9999999999", logo: "https://x/l.jpg", upiId: "secret@upi", upiPayeeName: "", paymentQr: "" });
});

await test("fetched once, then served from memory", async () => {
  const calls = [];
  const pr = new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: dir(), fetch: okFetch(calls) });
  await pr.get(); await pr.get();
  assert.equal(calls.length, 1);
});

await test("offline: uses the copy cached on disk", async () => {
  const d = dir();
  await new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: d, fetch: okFetch() }).get();
  const p = await new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: d, fetch: down }).get();
  assert.equal(p.name, "AD's Cafe");
});

await test("offline with no cache: empty details, never throws", async () => {
  const p = await new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: dir(), fetch: down }).get();
  assert.deepEqual(p, { name: "", address: "", city: "", phone: "", logo: "", upiId: "", upiPayeeName: "", paymentQr: "" });
});

await test("a slow / waking-up server never delays a print once any copy is cached", async () => {
  const d = dir();
  await new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: d, fetch: okFetch() }).get();
  const hang = () => new Promise(() => {}); // server never answers
  const t = Date.now();
  const p = await new RestaurantProfileProvider({ backendUrl: "https://a", cacheDir: d, fetch: hang }).get();
  assert.equal(p.name, "AD's Cafe");
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
