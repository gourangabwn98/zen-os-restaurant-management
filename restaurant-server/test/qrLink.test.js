// test/qrLink.test.js
// TBL-01 — table QR = a direct, absolute link into the customer PWA.
//   node test/qrLink.test.js
import assert from "node:assert/strict";
import { customerBaseUrl, tableQrUrl, takeawayQrUrl, isQrStale } from "../utils/qrLink.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
};

test("base: CUSTOMER_FRONTEND_URL wins; trailing slash dropped", () => {
  assert.equal(customerBaseUrl({ CUSTOMER_FRONTEND_URL: "https://order.hotelkhoai.co.in/" }), "https://order.hotelkhoai.co.in");
});

test("base: missing / not a URL → falls back to CLIENT_URL's public entry, never 'undefined'", () => {
  assert.equal(customerBaseUrl({ CLIENT_URL: "http://localhost:5173/,https://x.vercel.app" }), "https://x.vercel.app");
  assert.equal(customerBaseUrl({ CUSTOMER_FRONTEND_URL: "undefined", CLIENT_URL: "" }), null);
  assert.equal(customerBaseUrl({}), null);
  assert.equal(customerBaseUrl({ CUSTOMER_FRONTEND_URL: "ftp://x" }), null);
});

test("table link: absolute https, table + token in the query — opens the PWA in one tap", () => {
  const url = tableQrUrl("https://order.example.in", 7, "ab12cd");
  assert.equal(url, "https://order.example.in/?table=7&t=ab12cd");
  const u = new URL(url);
  assert.equal(u.searchParams.get("table"), "7");
  assert.equal(u.searchParams.get("t"), "ab12cd");
  assert.equal(takeawayQrUrl("https://order.example.in"), "https://order.example.in/?mode=takeaway");
});

test("stale: a QR made with an old/undefined base, or a different token, is flagged", () => {
  const base = "https://order.example.in";
  const ok = { tableNo: 3, qrToken: "t3", qrUrl: "https://order.example.in/?table=3&t=t3" };
  assert.equal(isQrStale(ok, base), false);
  assert.equal(isQrStale({ ...ok, qrUrl: "undefined/?table=3&t=t3" }, base), true);
  assert.equal(isQrStale({ ...ok, qrUrl: "https://zen-os-customer.vercel.app/?table=3&t=t3" }, base), true);
  assert.equal(isQrStale({ ...ok, qrToken: "other" }, base), true);
  assert.equal(isQrStale(ok, null), false, "no base configured is reported separately");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
