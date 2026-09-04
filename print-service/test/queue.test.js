import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { PrintQueue } from "../src/queue.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack}`); }
};

const tmpFile = () => path.join(os.tmpdir(), `print-queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

const run = async () => {
  console.log("── PrintQueue ───────────────────────────────────────────────");

  await test("a new job starts PENDING", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert({ jobId: "j1", jobType: "KOT" });
    assert.equal(q.get("j1").status, "PENDING");
  });

  await test("markPrinted → isTerminal is true; upsert can never undo it", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert({ jobId: "j1", jobType: "KOT" });
    q.markPrinted("j1");
    assert.equal(q.isTerminal("j1"), true);

    // Simulate a reconnect re-delivering the same job as PENDING (as the
    // backend queue would show it before our status report caught up).
    q.upsert({ jobId: "j1", jobType: "KOT", status: "PENDING" });
    assert.equal(q.get("j1").status, "PRINTED", "a PRINTED job must never be downgraded");
  });

  await test("markFailed increments attempts and records the error", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert({ jobId: "j1", jobType: "KOT" });
    q.markFailed("j1", new Error("printer offline"));
    const job = q.get("j1");
    assert.equal(job.status, "FAILED");
    assert.equal(job.attempts, 1);
    assert.equal(job.lastError, "printer offline");
  });

  await test("getRetryable includes PENDING and FAILED-under-limit, excludes PRINTED and exhausted", () => {
    const q = new PrintQueue(tmpFile());
    q.upsert({ jobId: "pending", jobType: "KOT" });
    q.upsert({ jobId: "printed", jobType: "KOT" }); q.markPrinted("printed");
    q.upsert({ jobId: "failed-once", jobType: "KOT" }); q.markFailed("failed-once", new Error("x"));
    q.upsert({ jobId: "exhausted", jobType: "KOT" });
    for (let i = 0; i < 5; i++) q.markFailed("exhausted", new Error("x"));

    const retryable = q.getRetryable(5).map((j) => j.jobId).sort();
    assert.deepEqual(retryable, ["failed-once", "pending"]);

    const exhausted = q.getExhausted(5).map((j) => j.jobId);
    assert.deepEqual(exhausted, ["exhausted"]);
  });

  await test("recoverStuckJobs turns a mid-print PRINTING job into FAILED (never silently assumes success)", () => {
    const file = tmpFile();
    const q1 = new PrintQueue(file);
    q1.upsert({ jobId: "j1", jobType: "KOT" });
    q1.markPrinting("j1"); // simulate the process dying right here

    // "restart" — a fresh instance reloading from disk
    const q2 = new PrintQueue(file);
    assert.equal(q2.get("j1").status, "PRINTING", "sanity: reload preserved the stuck state");
    q2.recoverStuckJobs();
    assert.equal(q2.get("j1").status, "FAILED");
    assert.match(q2.get("j1").lastError, /restart/i);
  });

  await test("state survives a full process restart via disk persistence", () => {
    const file = tmpFile();
    const q1 = new PrintQueue(file);
    q1.upsert({ jobId: "j1", jobType: "BILL", orderId: "ORD00099" });
    q1.markPrinted("j1");

    const q2 = new PrintQueue(file); // fresh instance, same file — "restart"
    assert.equal(q2.get("j1").status, "PRINTED");
    assert.equal(q2.get("j1").orderId, "ORD00099");
  });

  await test("a corrupt/missing queue file starts empty instead of crashing", () => {
    const file = tmpFile();
    fs.writeFileSync(file, "{ not valid json");
    const q = new PrintQueue(file);
    assert.equal(q.stats().total, 0);
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
