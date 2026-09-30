// test/usbDirectDriver.test.js — UsbDirectDriver against a fake `usb` module
// (WebUSB-style API, as in usb v3). No hardware needed.
import assert from "node:assert/strict";
import { UsbDirectDriver } from "../src/drivers/usbDirectDriver.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};

const printerItf = { interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [
  { direction: "in", type: "bulk", endpointNumber: 1 }, { direction: "out", type: "bulk", endpointNumber: 3 },
] }] };

const fakeDevice = ({ vendorId = 0x0483, productId = 0x5720, writeStatus = "ok", short = false } = {}) => {
  const d = {
    vendorId, productId, opened: false, claimed: [], writes: [], log: [],
    configurations: [{ interfaces: [printerItf] }],
    configuration: null,
    async open() { d.opened = true; d.log.push("open"); },
    async close() { d.opened = false; d.log.push("close"); },
    async selectConfiguration() { d.configuration = { interfaces: [printerItf] }; },
    async claimInterface(n) { d.claimed.push(n); d.log.push(`claim${n}`); },
    async releaseInterface(n) { d.log.push(`release${n}`); },
    async transferOut(ep, data) {
      d.writes.push({ ep, data });
      await new Promise((r) => setTimeout(r, 5));
      return { status: writeStatus, bytesWritten: short ? data.length - 1 : data.length };
    },
  };
  return d;
};
// A device whose descriptors can't be read (like a webcam) — must be skipped.
const unreadable = { get configurations() { throw new Error("getString error"); } };

const fakeUsb = (devices) => ({
  async getDevices() { return devices; },
  async findDeviceByIds(v, p) { return devices.find((d) => d.vendorId === v && d.productId === p); },
});

const LINES = [{ text: "BILL", align: "center" }, { text: "1 x Cold Coffee" }, { type: "cut" }];

await test("auto-detects the printer-class device, skipping unreadable ones", async () => {
  const dev = fakeDevice();
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([unreadable, dev]) });
  assert.equal(await drv.isOnline(), true);
});

await test("offline when no printer is attached", async () => {
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([unreadable]) });
  assert.equal(await drv.isOnline(), false);
});

await test("vendorId/productId pick a specific printer", async () => {
  const drv = new UsbDirectDriver({ id: "c", vendorId: "0483", productId: "5720" }, { usb: fakeUsb([fakeDevice({ productId: 1 })]) });
  assert.equal(await drv.isOnline(), false);
});

await test("prints ESC/POS bytes to the bulk OUT endpoint, then releases and closes", async () => {
  const dev = fakeDevice();
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([dev]) });
  await drv.printText(LINES);
  assert.equal(dev.writes.length, 1);
  assert.equal(dev.writes[0].ep, 3);
  assert.equal(dev.writes[0].data[0], 0x1b); // ESC @ (init) first
  assert.ok(dev.writes[0].data.includes(Buffer.from("Cold Coffee")));
  assert.deepEqual(dev.log, ["open", "claim0", "release0", "close"]);
});

await test("a missing printer fails the job with a clear message", async () => {
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([]) });
  await assert.rejects(drv.printText(LINES), /not found on USB/);
});

await test("an incomplete USB write fails the job (so it's retried) and still closes", async () => {
  const dev = fakeDevice({ short: true });
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([dev]) });
  await assert.rejects(drv.printText(LINES), /incomplete/);
  assert.equal(dev.opened, false);
});

await test("two jobs at once never interleave on the printer", async () => {
  const dev = fakeDevice();
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([dev]) });
  await Promise.all([drv.printText(LINES), drv.printText(LINES)]);
  assert.deepEqual(dev.log, ["open", "claim0", "release0", "close", "open", "claim0", "release0", "close"]);
});

await test("a failed job doesn't block the next one", async () => {
  const dev = fakeDevice({ short: true });
  const drv = new UsbDirectDriver({ id: "counter" }, { usb: fakeUsb([dev]) });
  await assert.rejects(drv.printText(LINES));
  dev.transferOut = async (ep, data) => ({ status: "ok", bytesWritten: data.length });
  await drv.printText(LINES);
});

await test("half a vendor/product id pair is a config error", () => {
  assert.throws(() => new UsbDirectDriver({ id: "c", vendorId: "0483" }), /both vendorId and productId/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
