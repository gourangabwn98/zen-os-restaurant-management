// Regression tests for the "sometimes doesn't print / prints late" fixes:
// local print state stays authoritative on reconcile, FAILED backoff, jobs the
// server dropped are never printed, lost PRINTED reports are re-sent, offline
// reasons are surfaced, sweeps never overlap, USB problems are reported, and
// the Windows QuickEdit switch-off is best-effort.
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { PrintQueue } from "../src/queue.js";
import { PrinterManager } from "../src/printerManager.js";
import { Processor } from "../src/processor.js";
import { SocketClient } from "../src/socketClient.js";
import { UsbDirectDriver } from "../src/drivers/usbDirectDriver.js";
import { disableQuickEdit } from "../src/consoleMode.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};
const tmpFile = () => path.join(os.tmpdir(), `print-rel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

const setup = ({ online = true, opts = {} } = {}) => {
  const manager = new PrinterManager([{ id: "counter", role: "BOTH", type: "LAN", startOnline: online }], { useMock: true });
  const driver = manager.drivers[0].driver;
  const queue = new PrintQueue(tmpFile());
  const reports = [];
  const processor = new Processor(queue, manager, async (jobId, jobType, status, error) => { reports.push({ jobId, status, error }); }, { maxAttempts: 5, ...opts });
  return { manager, driver, queue, reports, processor };
};
const kot = (id, extra = {}) => ({ jobId: id, jobType: "KOT", orderId: "ORD1", items: [{ name: "Tea", qty: 1 }], ...extra });

/** Fake socket answering get-queue with `backendJobs()`. */
const fakeSocket = (backendJobs) => ({
  connected: true,
  emitted: [],
  emit(event, payload, cb) {
    if (event === "get-queue") return cb({ jobs: backendJobs() });
    this.emitted.push({ event, payload });
  },
});

const run = async () => {
  console.log("── Print reliability ──────────────────────────────────────");

  await test("reconcile: a lagging backend 'PRINTING' never overwrites a local FAILED job (it stays retryable)", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert(kot("j1"));
    q.markFailed("j1", new Error("USB write incomplete"));
    q.upsert(kot("j1", { status: "PRINTING", attempts: 4 }));
    assert.equal(q.get("j1").status, "FAILED");
    assert.equal(q.get("j1").attempts, 1);
    assert.equal(q.getRetryable(5).length, 1);
  });

  await test("a job first seen from the backend starts PENDING with 0 attempts, whatever the backend counted", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert(kot("j1", { status: "FAILED", attempts: 9 }));
    assert.equal(q.get("j1").status, "PENDING");
    assert.equal(q.get("j1").attempts, 0);
  });

  await test("backoff: a FAILED job waits base × 2^(n-1) before its next try; PENDING never waits", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert(kot("failed")); q.markFailed("failed", new Error("x")); q.markFailed("failed", new Error("x")); // attempts 2 → 2 s
    q.upsert(kot("pending"));
    const t = Date.parse(q.get("failed").updatedAt);
    const ids = (now) => q.getRetryable(5, { baseDelayMs: 1000, now }).map((j) => j.jobId).sort();
    assert.deepEqual(ids(t + 1500), ["pending"]);
    assert.deepEqual(ids(t + 2000), ["failed", "pending"]);
  });

  await test("backoff is capped at 60 s", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert(kot("j")); for (let i = 0; i < 9; i++) q.markFailed("j", new Error("x"));
    const t = Date.parse(q.get("j").updatedAt);
    assert.equal(q.getRetryable(20, { baseDelayMs: 3000, now: t + 60000 }).length, 1);
  });

  await test("a job the server no longer lists (skipped / printed elsewhere) is never printed", async () => {
    const { processor, queue, driver } = setup({ online: false });
    await processor.ingest(kot("old"));
    const pullStarted = Date.now() + 1;
    const dropped = queue.dropMissing(new Set(), pullStarted);
    assert.equal(dropped.length, 1);
    driver.setOnline(true);
    await processor.retrySweep();
    assert.equal(queue.get("old").status, "SKIPPED");
    assert.equal(driver.printedJobs.length, 0);
  });

  await test("dropMissing keeps jobs that are listed, PRINTING, or first seen after the pull started", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert(kot("listed"));
    q.upsert(kot("printing")); q.markPrinting("printing");
    const pullStarted = Date.now() - 1000;
    q.upsert(kot("late")); // arrived (live push) after the pull was sent
    q.get("listed").firstSeenAt = new Date(pullStarted - 5000).toISOString();
    q.get("printing").firstSeenAt = new Date(pullStarted - 5000).toISOString();
    q.dropMissing(new Set(["listed"]), pullStarted);
    assert.equal(q.get("listed").status, "PENDING");
    assert.equal(q.get("printing").status, "PRINTING");
    assert.equal(q.get("late").status, "PENDING");
  });

  await test("a skipped job the server lists again (admin wants it) prints", async () => {
    const { processor, queue, driver } = setup();
    queue.upsert(kot("j")); queue.markSkipped("j", "test");
    await processor.ingest(kot("j", { status: "PENDING" }));
    assert.equal(queue.get("j").status, "PRINTED");
    assert.equal(driver.printedJobs.length, 1);
  });

  await test("already printed locally but still listed by the server → PRINTED is reported again, nothing reprinted", async () => {
    const { processor, driver, reports } = setup();
    await processor.ingest(kot("j"));
    reports.length = 0;
    await processor.ingest(kot("j", { status: "PENDING" }));
    assert.equal(driver.printedJobs.length, 1);
    assert.deepEqual(reports.map((r) => r.status), ["PRINTED"]);
  });

  await test("offline message says WHY when the driver knows (e.g. USB support missing)", async () => {
    const { processor, queue, driver } = setup({ online: false });
    driver.lastProblem = "USB support isn't available — keep the node_modules folder next to SohojPrintService.exe";
    await processor.ingest(kot("j"));
    assert.match(queue.get("j").lastError, /node_modules folder/);
  });

  await test("sweeps never overlap, and an offline printer is checked once per sweep (not once per job)", async () => {
    const { processor, queue, driver } = setup({ online: false });
    for (let i = 0; i < 5; i++) queue.upsert(kot(`j${i}`));
    let checks = 0;
    const orig = driver.isOnline.bind(driver);
    driver.isOnline = async () => { checks++; await new Promise((r) => setTimeout(r, 20)); return orig(); };
    const a = processor.retrySweep(), b = processor.retrySweep();
    assert.equal(a, b, "a second call while running returns the same sweep");
    await a;
    assert.equal(checks, 1);
  });

  await test("socket poll: drops server-skipped jobs, re-reports lost PRINTED, prints new ones", async () => {
    const { processor, queue, driver } = setup();
    await processor.ingest(kot("printed-locally"));
    queue.upsert(kot("skipped-on-server"));
    queue.get("skipped-on-server").firstSeenAt = new Date(Date.now() - 60000).toISOString();
    queue.get("skipped-on-server").status = "PENDING";
    driver.setOnline(false); // keep "skipped-on-server" from printing before the poll
    driver.setOnline(true);

    const client = new SocketClient({ backendUrl: "http://x", printerKey: "k", processor });
    const backend = [kot("printed-locally", { status: "PENDING" }), kot("brand-new", { status: "PENDING" })];
    client.socket = fakeSocket(() => backend);
    // Report path goes through the fake socket too:
    processor.reportStatus = (jobId, jobType, status, error) => client.reportStatus(jobId, jobType, status, error);

    await client.reconcileQueue({ onlyNew: true });
    assert.equal(queue.get("skipped-on-server").status, "SKIPPED");
    assert.equal(queue.get("brand-new").status, "PRINTED");
    const printedReports = client.socket.emitted.filter((e) => e.payload.status === "PRINTED").map((e) => e.payload.jobId).sort();
    assert.deepEqual(printedReports, ["brand-new", "printed-locally"]);
    assert.equal(driver.printedJobs.length, 2, "printed-locally once before + brand-new now");
  });

  await test("USB_DIRECT: a missing usb package is reported as the problem, not as 'printer off'", async () => {
    const d = new UsbDirectDriver({ id: "counter", vendorId: "0483", productId: "5720" },
      { usb: { findDeviceByIds: async () => { throw new Error("USB support isn't available (Cannot find module 'usb')"); } } });
    assert.equal(await d.isOnline(), false);
    assert.match(d.lastProblem, /USB support isn't available/);
  });

  await test("USB_DIRECT: not plugged in → clear message; found → no problem; hot-plug events wired", async () => {
    let device = null; const listeners = {};
    const usb = { findDeviceByIds: async () => device, addEventListener: (t, fn) => { listeners[t] = fn; } };
    const d = new UsbDirectDriver({ id: "counter", vendorId: "0483", productId: "5720" }, { usb });
    assert.equal(await d.isOnline(), false);
    assert.match(d.lastProblem, /not found on USB/);
    device = {};
    assert.equal(await d.isOnline(), true);
    assert.equal(d.lastProblem, null);
    const seen = [];
    assert.equal(d.onChange((e) => seen.push(e)), true);
    listeners.connect(); listeners.disconnect();
    assert.deepEqual(seen, ["connect", "disconnect"]);
  });

  await test("printer health: offline at startup is reported, and offline → online sets cameOnline", async () => {
    const manager = new PrinterManager([{ id: "p", role: "BOTH", type: "LAN", startOnline: false }], { useMock: true });
    await manager.checkAll();
    assert.equal(manager.drivers[0].status, "offline");
    assert.equal(manager.cameOnline, false);
    manager.drivers[0].driver.setOnline(true);
    await manager.checkAll();
    assert.equal(manager.cameOnline, true);
    await manager.checkAll();
    assert.equal(manager.cameOnline, false);
  });

  await test("QuickEdit: no-op off Windows / without a console; on Windows runs PowerShell sharing the console input", async () => {
    assert.equal(await disableQuickEdit({ platform: "linux", isTTY: true }), false);
    assert.equal(await disableQuickEdit({ platform: "win32", isTTY: false }), false);
    let call = null;
    const spawnImpl = (cmd, args, opts) => {
      call = { cmd, args, opts };
      const handlers = {};
      setTimeout(() => handlers.exit?.(0), 1);
      return { on: (ev, fn) => { handlers[ev] = fn; } };
    };
    assert.equal(await disableQuickEdit({ platform: "win32", isTTY: true, spawnImpl }), true);
    assert.equal(call.cmd, "powershell.exe");
    assert.equal(call.opts.stdio[0], "inherit");
    assert.match(call.args.at(-1), /SetConsoleMode/);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
