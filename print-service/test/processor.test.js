import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { PrintQueue } from "../src/queue.js";
import { PrinterManager } from "../src/printerManager.js";
import { Processor } from "../src/processor.js";
import { MockDriver } from "../src/drivers/mockDriver.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};

const tmpFile = () => path.join(os.tmpdir(), `print-proc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

/** A fake "backend" — records every status report the processor would have
 * sent over the socket, and lets us simulate the backend's own queue state
 * for reconnect-reconciliation tests. */
const makeFakeBackend = () => {
  const reports = [];
  const reportStatus = async (jobId, jobType, status, error) => {
    reports.push({ jobId, jobType, status, error });
  };
  return { reports, reportStatus };
};

const setup = ({ kotOnline = true, billOnline = true } = {}) => {
  const manager = new PrinterManager(
    [
      { id: "kitchen", role: "KOT", type: "LAN", startOnline: kotOnline },
      { id: "billing", role: "BILL", type: "USB", startOnline: billOnline },
    ],
    { useMock: true }
  );
  // PrinterManager builds real driver instances internally when useMock is
  // true it already uses MockDriver — grab references for direct control.
  const kotEntry  = manager.drivers.find((d) => d.role === "KOT");
  const billEntry = manager.drivers.find((d) => d.role === "BILL");

  const queue = new PrintQueue(tmpFile());
  const backend = makeFakeBackend();
  const processor = new Processor(queue, manager, backend.reportStatus, { maxAttempts: 3 });

  return { manager, queue, backend, processor, kotDriver: kotEntry.driver, billDriver: billEntry.driver };
};

const run = async () => {
  console.log("── End-to-end print flow simulation ───────────────────────");

  await test("LAN printer: a KOT job prints successfully", async () => {
    const { processor, queue, kotDriver } = setup();
    await processor.ingest({ jobId: "kot-1", jobType: "KOT", orderId: "ORD00001", tableNo: 4, items: [{ name: "Dosa", qty: 2 }] });
    assert.equal(queue.get("kot-1").status, "PRINTED");
    assert.equal(kotDriver.printedJobs.length, 1);
  });

  await test("USB printer: a BILL job prints successfully", async () => {
    const { processor, queue, billDriver } = setup();
    await processor.ingest({ jobId: "bill-1", jobType: "BILL", orderId: "ORD00001", payload: { items: [], subtotal: 0, total: 0 } });
    assert.equal(queue.get("bill-1").status, "PRINTED");
    assert.equal(billDriver.printedJobs.length, 1);
  });

  await test("printer offline: job stays in the queue as FAILED — the order is never lost", async () => {
    const { processor, queue } = setup({ kotOnline: false });
    await processor.ingest({ jobId: "kot-2", jobType: "KOT", orderId: "ORD00002", items: [{ name: "Idli", qty: 1 }] });
    const job = queue.get("kot-2");
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempts, 1);
    assert.match(job.lastError, /offline/i);
  });

  await test("printer reconnect: job left FAILED while offline succeeds once printer comes back online, via retry sweep", async () => {
    const { processor, queue, kotDriver } = setup({ kotOnline: false });
    await processor.ingest({ jobId: "kot-3", jobType: "KOT", orderId: "ORD00003", items: [{ name: "Vada", qty: 3 }] });
    assert.equal(queue.get("kot-3").status, "FAILED");

    kotDriver.setOnline(true); // printer reconnects
    await processor.retrySweep();

    assert.equal(queue.get("kot-3").status, "PRINTED");
    assert.equal(kotDriver.printedJobs.length, 1);
  });

  await test("Socket/backend reconnect: re-ingesting an already-printed job (as the queue-pull reconciliation would) never prints it again", async () => {
    const { processor, queue, kotDriver } = setup();
    await processor.ingest({ jobId: "kot-4", jobType: "KOT", orderId: "ORD00004", items: [{ name: "Uttapam", qty: 1 }] });
    assert.equal(kotDriver.printedJobs.length, 1);

    // Simulate a reconnect: the print-service calls get-queue again and the
    // backend still shows this job (status lag, or it just hadn't been
    // marked PRINTED there yet) — it gets ingested a second time.
    await processor.ingest({ jobId: "kot-4", jobType: "KOT", orderId: "ORD00004", items: [{ name: "Uttapam", qty: 1 }], status: "PENDING" });

    assert.equal(kotDriver.printedJobs.length, 1, "must still be exactly one physical print");
    assert.equal(queue.get("kot-4").status, "PRINTED");
  });

  await test("print-service restart: a job stuck PRINTING when the process died is retried, not lost, and not silently assumed successful", async () => {
    const file = tmpFile();
    const manager1 = new PrinterManager([{ id: "kitchen", role: "KOT", type: "LAN", startOnline: true }], { useMock: true });
    const queue1 = new PrintQueue(file);
    queue1.upsert({ jobId: "kot-5", jobType: "KOT", orderId: "ORD00005", items: [{ name: "Poha", qty: 1 }] });
    queue1.markPrinting("kot-5"); // process dies here — mid print, outcome unknown

    // "restart" — brand new process, same queue file
    const queue2 = new PrintQueue(file);
    queue2.recoverStuckJobs();
    assert.equal(queue2.get("kot-5").status, "FAILED");

    const manager2 = new PrinterManager([{ id: "kitchen", role: "KOT", type: "LAN", startOnline: true }], { useMock: true });
    const backend2 = makeFakeBackend();
    const processor2 = new Processor(queue2, manager2, backend2.reportStatus, { maxAttempts: 3 });
    await processor2.retrySweep();

    assert.equal(queue2.get("kot-5").status, "PRINTED");
  });

  await test("duplicate confirmation: the same job id delivered concurrently (e.g. a live push racing a queue-pull) results in exactly one physical print", async () => {
    const { processor, kotDriver } = setup();
    const job = { jobId: "kot-6", jobType: "KOT", orderId: "ORD00006", items: [{ name: "Sambar Rice", qty: 1 }] };

    // Fire both "delivery paths" at once, as could genuinely happen if a
    // live kot:created event arrives at the same moment as a reconnect's
    // get-queue reconciliation.
    await Promise.all([processor.ingest(job), processor.ingest(job)]);

    assert.equal(kotDriver.printedJobs.length, 1, "must never double-print from concurrent delivery of the same job id");
  });

  await test("a job exhausting all retry attempts stops retrying but is still visible, never deleted", async () => {
    const { processor, queue } = setup({ kotOnline: false });
    await processor.ingest({ jobId: "kot-7", jobType: "KOT", orderId: "ORD00007", items: [{ name: "Rava Kesari", qty: 1 }] });
    await processor.retrySweep(); // attempt 2
    await processor.retrySweep(); // attempt 3 — now at maxAttempts (3)

    const job = queue.get("kot-7");
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempts, 3);
    assert.equal(queue.getExhausted(3).length, 1);
    assert.equal(queue.getRetryable(3).length, 0, "exhausted job must stop being retried automatically");
  });

  await test("KOT and BILL jobs route to their own configured printer independently", async () => {
    const { processor, kotDriver, billDriver } = setup();
    await processor.ingest({ jobId: "kot-8", jobType: "KOT", orderId: "ORD00008", items: [{ name: "Filter Coffee", qty: 2 }] });
    await processor.ingest({ jobId: "bill-8", jobType: "BILL", orderId: "ORD00008", payload: { items: [], subtotal: 0, total: 0 } });

    assert.equal(kotDriver.printedJobs.length, 1);
    assert.equal(billDriver.printedJobs.length, 1);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
