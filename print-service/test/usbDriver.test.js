import assert from "node:assert/strict";
import fs from "fs";
import { UsbDriver } from "../src/drivers/usbDriver.js";
import { renderKot } from "../src/renderers/kotRenderer.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};

/** Records every shell command it's asked to run instead of actually
 * running anything — lets us verify the exact command built without
 * needing a real Windows machine. */
const makeFakeExec = ({ shouldFail = false } = {}) => {
  const calls = [];
  const exec = async (cmd, opts) => {
    calls.push({ cmd, opts });
    if (shouldFail) throw new Error("The system cannot find the file specified.");
    return { stdout: "Normal", stderr: "" };
  };
  return { exec, calls };
};

const run = async () => {
  console.log("── UsbDriver (Windows print-share path) ────────────────────");

  await test("constructor requires windowsPrinterName", () => {
    assert.throws(() => new UsbDriver({ id: "billing" }), /windowsPrinterName/);
  });

  await test("printText writes a temp file and copies it, in binary mode, to the printer's UNC share", async () => {
    const { exec, calls } = makeFakeExec();
    const driver = new UsbDriver(
      { id: "billing", windowsPrinterName: "EPSON_TM_T88V" },
      { exec, platform: "win32" }
    );

    const lines = renderKot({ orderId: "ORD00001", tableNo: 3, items: [{ name: "Dosa", qty: 1 }] });
    await driver.printText(lines);

    assert.equal(calls.length, 1);
    assert.match(calls[0].cmd, /^copy \/b /, "must use binary-mode copy so ESC\\/POS control bytes survive");
    assert.match(calls[0].cmd, /\\\\localhost\\EPSON_TM_T88V/, "must target the printer's UNC share path");
  });

  await test("windowsShareName overrides the share path when the share was renamed", async () => {
    const { exec, calls } = makeFakeExec();
    const driver = new UsbDriver(
      { id: "billing", windowsPrinterName: "EPSON_TM_T88V", windowsShareName: "FrontDeskPrinter" },
      { exec, platform: "win32" }
    );
    await driver.printText(renderKot({ orderId: "ORD00002", items: [{ name: "Idli", qty: 1 }] }));
    assert.match(calls[0].cmd, /\\\\localhost\\FrontDeskPrinter/);
  });

  await test("the temp .prn file is cleaned up after sending", async () => {
    const { exec } = makeFakeExec();
    let capturedPath = null;
    const origWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = (p, data) => { capturedPath = p; return origWriteFileSync(p, data); };

    try {
      const driver = new UsbDriver({ id: "billing", windowsPrinterName: "X" }, { exec, platform: "win32" });
      await driver.printText(renderKot({ orderId: "ORD00003", items: [{ name: "Vada", qty: 1 }] }));
      // fs.unlink is async/best-effort — give it a tick to run.
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(capturedPath, "sanity: a temp file path was used");
      assert.equal(fs.existsSync(capturedPath), false, "temp file must not be left behind");
    } finally {
      fs.writeFileSync = origWriteFileSync;
    }
  });

  await test("a failed copy command produces a clear, actionable error — and the job is not silently swallowed", async () => {
    const { exec } = makeFakeExec({ shouldFail: true });
    const driver = new UsbDriver({ id: "billing", windowsPrinterName: "EPSON_TM_T88V" }, { exec, platform: "win32" });

    await assert.rejects(
      () => driver.printText(renderKot({ orderId: "ORD00004", items: [{ name: "Uttapam", qty: 1 }] })),
      /Could not send data to shared printer "EPSON_TM_T88V".*is it shared/i
    );
  });

  await test("printText refuses cleanly on a non-Windows platform (no Windows print-share concept there)", async () => {
    const { exec } = makeFakeExec();
    const driver = new UsbDriver({ id: "billing", windowsPrinterName: "X" }, { exec, platform: "linux" });
    await assert.rejects(
      () => driver.printText(renderKot({ orderId: "ORD00005", items: [{ name: "Sambar", qty: 1 }] })),
      /only supported when this service runs on Windows/
    );
  });

  await test("isOnline reports true when Get-Printer reports status Normal", async () => {
    const { exec } = makeFakeExec();
    const driver = new UsbDriver({ id: "billing", windowsPrinterName: "EPSON_TM_T88V" }, { exec, platform: "win32" });
    assert.equal(await driver.isOnline(), true);
  });

  await test("isOnline reports false when the printer reports a non-Normal status", async () => {
    const exec = async () => ({ stdout: "Offline", stderr: "" });
    const driver = new UsbDriver({ id: "billing", windowsPrinterName: "EPSON_TM_T88V" }, { exec, platform: "win32" });
    assert.equal(await driver.isOnline(), false);
  });

  await test("isOnline never throws even if the health-check command itself fails (doesn't block a real print attempt on a flaky check)", async () => {
    const exec = async () => { throw new Error("powershell not found"); };
    const driver = new UsbDriver({ id: "billing", windowsPrinterName: "EPSON_TM_T88V" }, { exec, platform: "win32" });
    assert.equal(await driver.isOnline(), true);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
