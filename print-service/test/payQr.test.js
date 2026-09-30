// test/payQr.test.js — "Scan & Pay" QR on unpaid bills (src/payQr.js + bill layout).
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { upiPayUrl, qrBitmap, isUpiId, PayQrProvider } from "../src/payQr.js";
import { renderBill } from "../src/renderers/billRenderer.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};

const PROFILE = { name: "AD's Cafe", upiId: "Q316276366@ybl", upiPayeeName: "AD's Cafe", paymentQr: "https://x/qr.png" };
const BILL = { orderId: "ORD00191", total: 1743, paymentStatus: "PENDING_VERIFICATION", items: [], subtotal: 1743 };

await test("UPI link carries payee, name, the bill total, INR and the bill number", () => {
  const url = upiPayUrl({ upiId: "Q316276366@ybl", payeeName: "AD's Cafe", amount: 1743, note: "Bill ORD00191" });
  assert.equal(url, "upi://pay?pa=Q316276366@ybl&pn=AD%27s%20Cafe&am=1743.00&cu=INR&tn=Bill%20ORD00191");
  const u = new URL(url.replace("upi://", "https://x/"));
  assert.equal(u.searchParams.get("pa"), "Q316276366@ybl");
  assert.equal(u.searchParams.get("am"), "1743.00");
});

await test("UPI ID validation", () => {
  assert.ok(isUpiId("Q316276366@ybl"));
  assert.ok(isUpiId("cafe.name-1@okhdfcbank"));
  assert.ok(!isUpiId("not an id"));
  assert.ok(!isUpiId(""));
});

await test("the printed bitmap is an exact dot-for-dot copy of the QR code (so it scans)", () => {
  const text = upiPayUrl({ upiId: "Q316276366@ybl", payeeName: "AD's Cafe", amount: 1743, note: "Bill ORD00191" });
  const bm = qrBitmap(text, { sizeDots: 240 });
  assert.equal(bm.width % 8, 0);
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size, quiet = 4;
  const scale = Math.floor(240 / (n + 8));
  const offset = Math.floor((bm.width - (n + 8) * scale) / 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = offset + (c + quiet) * scale + (scale >> 1), y = (r + quiet) * scale + (scale >> 1);
    const black = bm.data[(y * bm.width + x) * 4] === 0;
    assert.equal(black, Boolean(modules.get(r, c)), `module ${r},${c}`);
  }
  // quiet zone is blank paper
  for (let x = 0; x < bm.width; x++) assert.equal(bm.data[x * 4], 255);
});

await test("unpaid bill with a UPI ID → generated QR with the amount", async () => {
  const qr = await new PayQrProvider().forBill(BILL, PROFILE);
  assert.equal(qr.upiId, "Q316276366@ybl");
  assert.equal(qr.amount, 1743);
  assert.ok(qr.bitmap.width > 0);
});

await test("a PAID bill never gets a QR", async () => {
  assert.equal(await new PayQrProvider().forBill({ ...BILL, paymentStatus: "PAID" }, PROFILE), null);
});

await test("no UPI ID → the uploaded payment QR image is used", async () => {
  const img = { width: 8, height: 8, data: Buffer.alloc(256, 255) };
  const calls = [];
  const qr = await new PayQrProvider({ imageProvider: { get: async (u) => { calls.push(u); return img; } } })
    .forBill(BILL, { ...PROFILE, upiId: "" });
  assert.equal(qr.bitmap, img);
  assert.equal(qr.upiId, undefined);
  assert.deepEqual(calls, ["https://x/qr.png"]);
});

await test("nothing configured (or a zero total) → no QR", async () => {
  assert.equal(await new PayQrProvider().forBill(BILL, {}), null);
  assert.equal(await new PayQrProvider().forBill({ ...BILL, total: 0 }, { upiId: "a@ybl" }), null);
});

await test("bill layout: Scan & Pay block after TOTAL, before the thank-you", () => {
  const payQr = { bitmap: { width: 8, height: 8, data: Buffer.alloc(256, 255) }, upiId: "Q316276366@ybl", amount: 1743 };
  const lines = renderBill({ payload: BILL }, { payQr, width: 48 });
  const idx = (pred) => lines.findIndex(pred);
  const total = idx((l) => /^TOTAL/.test(l.text || ""));
  const title = idx((l) => l.text === "Scan & Pay (UPI)");
  const image = idx((l) => l.type === "image");
  const thanks = idx((l) => /Thank you/.test(l.text || ""));
  assert.ok(total < title && title < image && image < thanks, `${total} ${title} ${image} ${thanks}`);
  assert.ok(lines.some((l) => l.text === "UPI: Q316276366@ybl"));
  assert.ok(lines.some((l) => l.text === "Amount: Rs1743" && l.bold));
  for (const l of lines) if (l.text) assert.ok(l.text.length <= 48);
});

await test("bill layout: no QR block when none is given", () => {
  assert.ok(!renderBill({ payload: BILL }).some((l) => /Scan & Pay/.test(l.text || "")));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
