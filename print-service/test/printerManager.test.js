import assert from "node:assert/strict";
import { PrinterManager } from "../src/printerManager.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};

const run = async () => {
  console.log("── PrinterManager resilience ───────────────────────────────");

  await test("a bad printer config (missing required field) does not prevent other printers from initializing", () => {
    // This is the exact class of bug reported live: a USB printer that
    // fails to construct used to throw out of a .map() and take the whole
    // service down, including an otherwise-healthy LAN printer.
    const manager = new PrinterManager(
      [
        { id: "kitchen", role: "KOT", type: "LAN", ip: "192.168.1.50", port: 9100 },
        { id: "broken", role: "BILL", type: "USB" }, // missing windowsPrinterName — must fail to construct
      ],
      { useMock: false }
    );

    assert.equal(manager.drivers.length, 1, "the healthy LAN printer must still be initialized");
    assert.equal(manager.drivers[0].driver.id, "kitchen");
  });

  await test("an unknown printer type is rejected without crashing the others", () => {
    const manager = new PrinterManager(
      [
        { id: "kitchen", role: "KOT", type: "LAN", ip: "10.0.0.5", port: 9100 },
        { id: "mystery", role: "BILL", type: "BLUETOOTH" },
      ],
      { useMock: false }
    );
    assert.equal(manager.drivers.length, 1);
  });

  await test("all-bad config results in zero drivers, not a crash", () => {
    const manager = new PrinterManager(
      [{ id: "broken1", role: "KOT", type: "USB" }, { id: "broken2", role: "BILL", type: "LAN" }],
      { useMock: false }
    );
    assert.equal(manager.drivers.length, 0);
  });

  await test("driverFor still resolves correctly when only one printer initialized successfully", () => {
    const manager = new PrinterManager(
      [
        { id: "kitchen", role: "KOT", type: "LAN", ip: "10.0.0.5", port: 9100 },
        { id: "broken", role: "BILL", type: "USB" },
      ],
      { useMock: false }
    );
    assert.ok(manager.driverFor("KOT"));
    assert.equal(manager.driverFor("BILL"), null, "no BILL printer available — correctly reports none, not a crash");
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
