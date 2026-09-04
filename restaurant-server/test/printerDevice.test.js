// test/printerDevice.test.js
import assert from "node:assert/strict";
import {
  generatePrinterKey, createPrinterDevice, verifyPrinterKey, revokePrinterDevice,
} from "../services/printerDeviceService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

// ── Minimal fake PrinterDevice model (in-memory) ────────────────────────────
const makeFakeModel = () => {
  const docs = new Map();
  let seq = 0;

  const wrap = (doc) => ({
    ...doc,
    save: async function () { docs.set(String(this._id), { ...this }); },
  });

  return {
    create: async (data) => {
      const _id = String(++seq);
      const doc = { _id, status: "Active", lastStatus: "offline", lastSeenAt: null, lastError: "", ...data };
      docs.set(_id, doc);
      return wrap(doc);
    },
    findOne: async (query) => {
      for (const d of docs.values()) {
        if (d.keyHash === query.keyHash && d.status === query.status) return wrap(d);
      }
      return null;
    },
    findById: async (id) => {
      const d = docs.get(String(id));
      return d ? wrap(d) : null;
    },
    findByIdAndUpdate: async (id, { $set }) => {
      const d = docs.get(String(id));
      if (!d) return null;
      Object.assign(d, $set);
      docs.set(String(id), d);
      return wrap(d);
    },
  };
};

const run = async () => {
  console.log("── printer device credentials ──────────────────────────────");

  await test("generatePrinterKey produces a unique, prefixed secret", () => {
    const a = generatePrinterKey();
    const b = generatePrinterKey();
    assert.ok(a.startsWith("prn_"));
    assert.notEqual(a, b);
    assert.ok(a.length > 20);
  });

  await test("createPrinterDevice never stores the plaintext key", async () => {
    const PrinterDevice = makeFakeModel();
    const { device, plainKey } = await createPrinterDevice({
      PrinterDevice, name: "Kitchen Printer", role: "KOT", connectionType: "LAN", lanIp: "192.168.1.50", lanPort: 9100,
    });
    assert.ok(plainKey.startsWith("prn_"));
    assert.notEqual(device.keyHash, plainKey);
    assert.equal(device.keyHash.length, 64); // sha256 hex
  });

  await test("verifyPrinterKey accepts the correct key and rejects a wrong one", async () => {
    const PrinterDevice = makeFakeModel();
    const { plainKey } = await createPrinterDevice({ PrinterDevice, name: "Bill Printer", role: "BILL", connectionType: "USB", usbPrinterName: "EPSON_TM_T88" });

    const okDevice = await verifyPrinterKey({ PrinterDevice, plainKey });
    assert.ok(okDevice);
    assert.equal(okDevice.name, "Bill Printer");

    const badDevice = await verifyPrinterKey({ PrinterDevice, plainKey: "prn_totally_wrong_key" });
    assert.equal(badDevice, null);
  });

  await test("a revoked device's key no longer verifies", async () => {
    const PrinterDevice = makeFakeModel();
    const { device, plainKey } = await createPrinterDevice({ PrinterDevice, name: "Kitchen 2", role: "KOT", connectionType: "LAN" });

    let ok = await verifyPrinterKey({ PrinterDevice, plainKey });
    assert.ok(ok);

    await revokePrinterDevice({ PrinterDevice, id: device._id });

    ok = await verifyPrinterKey({ PrinterDevice, plainKey });
    assert.equal(ok, null);
  });

  await test("verifyPrinterKey with no key at all returns null (no accidental open access)", async () => {
    const PrinterDevice = makeFakeModel();
    const result = await verifyPrinterKey({ PrinterDevice, plainKey: "" });
    assert.equal(result, null);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
