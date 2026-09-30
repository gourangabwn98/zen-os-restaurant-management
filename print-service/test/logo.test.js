// test/logo.test.js — bill logo (src/logo.js), its rendering, and that a
// logo problem never stops a bill from printing. No network, no hardware.
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { PNG } from "pngjs";
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { cloudinaryPngUrl, toReceiptBitmap, LogoProvider } from "../src/logo.js";
import { renderBill } from "../src/renderers/billRenderer.js";
import { renderLinesToPrinter } from "../src/drivers/renderLines.js";
import { Processor } from "../src/processor.js";
import { PrintQueue } from "../src/queue.js";
import { PrinterManager } from "../src/printerManager.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};

/** w×h PNG, every pixel `rgb` (or rgb(x,y)). */
const makePng = (w, h, rgb) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = typeof rgb === "function" ? rgb(x, y) : rgb;
    const i = (y * w + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
  }
  return PNG.sync.write(png);
};
const okFetch = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf });
const downFetch = async () => { throw new Error("offline"); };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "logo-test-"));
const blackShare = (bm) => { let n = 0; for (let i = 0; i < bm.width * bm.height; i++) if (bm.data[i * 4] === 0) n++; return n / (bm.width * bm.height); };

const LOGO_URL = "https://res.cloudinary.com/demo/image/upload/v17/adda-logos/abc.jpg";

await test("Cloudinary URLs are resized and converted to PNG; others untouched", () => {
  assert.equal(cloudinaryPngUrl(LOGO_URL, 192, 160),
    "https://res.cloudinary.com/demo/image/upload/c_limit,w_192,h_160/f_png/v17/adda-logos/abc.jpg");
  assert.equal(cloudinaryPngUrl("https://example.com/logo.png", 192, 160), "https://example.com/logo.png");
});

await test("output is pure black/white and opaque", () => {
  const bm = toReceiptBitmap(PNG.sync.read(makePng(16, 16, (x) => [x * 16, x * 16, x * 16])));
  for (let i = 0; i < 16 * 16; i++) {
    assert.ok(bm.data[i * 4] === 0 || bm.data[i * 4] === 255);
    assert.equal(bm.data[i * 4 + 3], 255);
  }
});

await test("a dark-background logo is inverted so it isn't a solid black block", () => {
  // Mostly black with a small light mark — like the café logo.
  const src = PNG.sync.read(makePng(40, 40, (x, y) => (x > 15 && x < 25 && y > 15 && y < 25 ? [230, 200, 150] : [10, 10, 10])));
  const auto = toReceiptBitmap(src);
  assert.equal(auto.inverted, true);
  assert.ok(blackShare(auto) < 0.2, `black share ${blackShare(auto)}`);
  assert.ok(blackShare(toReceiptBitmap(src, { invert: false })) > 0.8);
});

await test("a light-background logo is printed as-is", () => {
  const src = PNG.sync.read(makePng(40, 40, (x, y) => (x > 15 && x < 25 && y > 15 && y < 25 ? [0, 0, 0] : [255, 255, 255])));
  const bm = toReceiptBitmap(src);
  assert.equal(bm.inverted, false);
  assert.ok(blackShare(bm) > 0.03 && blackShare(bm) < 0.1);
});

await test("transparent pixels count as paper", () => {
  const bm = toReceiptBitmap(PNG.sync.read(makePng(8, 8, [0, 0, 0, 0])), { invert: false });
  assert.equal(blackShare(bm), 0);
});

await test("mid-grey is dithered (a mix of dots), not flattened to one colour", () => {
  const share = blackShare(toReceiptBitmap(PNG.sync.read(makePng(32, 32, [128, 128, 128])), { invert: false }));
  assert.ok(share > 0.3 && share < 0.7, `share ${share}`);
});

await test("downloads, converts and caches the logo; reuses it offline", async () => {
  const dir = tmpDir();
  const png = makePng(20, 10, [255, 255, 255]);
  const bm = await new LogoProvider({ cacheDir: dir, fetch: okFetch(png) }).get(LOGO_URL);
  assert.equal(bm.width, 20);
  assert.ok(fs.existsSync(path.join(dir, "logo-cache.png")));
  const offline = await new LogoProvider({ cacheDir: dir, fetch: downFetch }).get(LOGO_URL);
  assert.equal(offline.width, 20); // from the disk cache
});

await test("offline with no cache, a non-PNG, or no URL → no logo (not an error)", async () => {
  assert.equal(await new LogoProvider({ cacheDir: tmpDir(), fetch: downFetch }).get(LOGO_URL), null);
  assert.equal(await new LogoProvider({ cacheDir: tmpDir(), fetch: okFetch(Buffer.from("<html>")) }).get(LOGO_URL), null);
  assert.equal(await new LogoProvider({ cacheDir: tmpDir(), fetch: okFetch(makePng(4, 4, [0, 0, 0])) }).get(""), null);
});

await test("a changed logo URL (admin uploaded a new one) is fetched fresh", async () => {
  const dir = tmpDir();
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, arrayBuffer: async () => makePng(8, 8, [255, 255, 255]) }; };
  const lp = new LogoProvider({ cacheDir: dir, fetch });
  await lp.get(LOGO_URL); await lp.get(LOGO_URL);
  assert.equal(calls, 1); // cached in memory
  await lp.get(LOGO_URL.replace("abc", "new"));
  assert.equal(calls, 2);
});

await test("renderBill puts the logo first, above the restaurant name", () => {
  const logo = { width: 8, height: 8, data: Buffer.alloc(256, 255) };
  const lines = renderBill({ payload: { restaurantName: "AD's Cafe", items: [], total: 0 } }, { logo });
  assert.equal(lines[0].type, "image");
  assert.equal(lines[1].text, "AD's Cafe");
  assert.notEqual(renderBill({ payload: {} })[0].type, "image"); // no logo → unchanged
});

await test("the logo becomes an ESC/POS raster image (GS v 0) in the print data", () => {
  const printer = new ThermalPrinter({ type: PrinterTypes.EPSON, removeSpecialCharacters: false });
  const bitmap = toReceiptBitmap(PNG.sync.read(makePng(16, 4, [0, 0, 0])), { invert: false });
  renderLinesToPrinter(printer, [{ type: "image", bitmap }, { text: "hi" }]);
  const buf = printer.getBuffer();
  assert.ok(buf.includes(Buffer.from([0x1d, 0x76, 0x30])), "GS v 0 raster command present");
});

await test("a broken logo never fails the bill — it prints without it", async () => {
  const manager = new PrinterManager([{ id: "p", role: "BOTH", type: "USB", startOnline: true }], { useMock: true });
  const queue = new PrintQueue(path.join(tmpDir(), "q.json"));
  const reports = [];
  const processor = new Processor(queue, manager, async (id, t, status) => reports.push(status), {
    logoProvider: { get: async () => { throw new Error("boom"); } },
  });
  await processor.ingest({ jobId: "b1", jobType: "BILL", payload: { restaurantName: "X", logoUrl: LOGO_URL, items: [], total: 1 } });
  assert.equal(reports.at(-1), "PRINTED");
  assert.notEqual(manager.drivers[0].driver.printedJobs[0][0].type, "image");
});

await test("a bill with a logo URL prints the logo", async () => {
  const manager = new PrinterManager([{ id: "p", role: "BOTH", type: "USB", startOnline: true }], { useMock: true });
  const queue = new PrintQueue(path.join(tmpDir(), "q.json"));
  const logo = { width: 8, height: 8, data: Buffer.alloc(256, 255) };
  const processor = new Processor(queue, manager, async () => {}, { logoProvider: { get: async () => logo } });
  await processor.ingest({ jobId: "b2", jobType: "BILL", payload: { restaurantName: "X", logoUrl: LOGO_URL, items: [], total: 1 } });
  assert.equal(manager.drivers[0].driver.printedJobs[0][0].type, "image");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
