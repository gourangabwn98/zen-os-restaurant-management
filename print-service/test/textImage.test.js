// test/textImage.test.js — non-Latin text (Bengali…) printed as images
// (src/textImage.js). Drawing is faked (writes a PNG) so this runs anywhere.
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { PNG } from "pngjs";
import { TextImageRenderer } from "../src/textImage.js";
import { renderBill } from "../src/renderers/billRenderer.js";
import { renderKot } from "../src/renderers/kotRenderer.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "textimg-"));
const BN_NAME = "Hotel খোয়াই";
const fakeDraw = (calls) => async (specs) => {
  calls.push(specs);
  for (const s of specs) {
    const png = new PNG({ width: s.width, height: s.height });
    png.data.fill(255);
    png.data[0] = png.data[1] = png.data[2] = 0; // one black dot
    fs.mkdirSync(path.dirname(s.file), { recursive: true });
    fs.writeFileSync(s.file, PNG.sync.write(png));
  }
};

await test("only lines the printer can't show become images; English stays text", async () => {
  const calls = [];
  const r = new TextImageRenderer({ cacheDir: dir(), draw: fakeDraw(calls), platform: "win32" });
  const lines = renderBill({ payload: { orderId: "O1", items: [{ name: "Tea", qty: 1, price: 10 }], subtotal: 10, total: 10 } },
    { header: { name: BN_NAME, city: "Purba Burdwan" }, width: 48 });
  const out = await r.apply(lines, { charsPerLine: 48 });
  const imgs = out.filter((l) => l.type === "image");
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].label.normalize("NFKD"), BN_NAME.normalize("NFKD")); // same text (য় may be stored as য + ়)
  assert.equal(imgs[0].bitmap.width, 576);      // 48 chars × 12 dots
  assert.equal(imgs[0].feedAfter, false);       // no blank line after it
  assert.ok(out.some((l) => l.text === "TAX INVOICE"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].height, 64);         // double-height name
  assert.equal(calls[0][0].bold, true);
  assert.equal(calls[0][0].font, "Nirmala UI");
});

await test("columns keep their positions (label/value, name/qty/amount)", async () => {
  const calls = [];
  const r = new TextImageRenderer({ cacheDir: dir(), draw: fakeDraw(calls), platform: "win32" });
  const lines = renderBill({ payload: { orderId: "O1", guestName: "সৌরভ",
    items: [{ name: "মাছ", qty: 2, price: 150 }], subtotal: 300, total: 300 } }, { width: 48 });
  await r.apply(lines, { charsPerLine: 48 });
  const specs = calls[0];
  const customer = specs.find((s) => s.cells.some((c) => c.text.startsWith("Customer")));
  assert.deepEqual(customer.cells.map((c) => [c.x, c.align]), [[0, "left"], [13 * 12, "right"]]);
  assert.equal(customer.cells[1].x + customer.cells[1].w, 576); // value flush right
  const item = specs.find((s) => s.cells.some((c) => c.text === "Rs300"));
  assert.deepEqual(item.cells.map((c) => c.align), ["left", "right", "right"]);
  assert.equal(item.cells[2].x + item.cells[2].w, 576);
});

await test("each line is drawn once, then served from cache", async () => {
  const calls = [];
  const d = dir();
  const lines = renderKot({ orderId: "O1", items: [{ name: "মাছ", qty: 1 }] }, { header: { name: BN_NAME }, width: 48 });
  await new TextImageRenderer({ cacheDir: d, draw: fakeDraw(calls), platform: "win32" }).apply(lines, { charsPerLine: 48 });
  await new TextImageRenderer({ cacheDir: d, draw: fakeDraw(calls), platform: "win32" }).apply(lines, { charsPerLine: 48 });
  assert.equal(calls.length, 1); // second run: disk cache
});

await test("not Windows, or drawing fails → lines unchanged (they print as '?')", async () => {
  const lines = [{ text: BN_NAME, align: "center" }];
  assert.equal(await new TextImageRenderer({ cacheDir: dir(), platform: "linux" }).apply(lines), lines);
  const broken = new TextImageRenderer({ cacheDir: dir(), platform: "win32", draw: async () => { throw new Error("blocked"); } });
  assert.equal(await broken.apply(lines), lines);
});

await test("nothing to draw → no PowerShell run at all", async () => {
  const calls = [];
  const lines = [{ text: "Cold Coffee" }];
  assert.equal(await new TextImageRenderer({ cacheDir: dir(), draw: fakeDraw(calls), platform: "win32" }).apply(lines), lines);
  assert.equal(calls.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
