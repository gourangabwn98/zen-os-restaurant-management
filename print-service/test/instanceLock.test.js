// test/instanceLock.test.js — one print service per printer key (src/instanceLock.js).
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { acquireInstanceLock } from "../src/instanceLock.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.stack}`); }
};
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
const alive = (pids) => (pid) => pids.includes(pid);

await test("a second copy with the same key is refused while the first runs", () => {
  const d = dir();
  const a = acquireInstanceLock("prn_key", { dir: d, pid: 100, isRunning: alive([100]) });
  assert.equal(a.ok, true);
  const b = acquireInstanceLock("prn_key", { dir: d, pid: 200, isRunning: alive([100, 200]) });
  assert.equal(b.ok, false);
  assert.equal(b.pid, 100);
});

await test("a lock left by a crashed run (PID gone) is taken over", () => {
  const d = dir();
  acquireInstanceLock("prn_key", { dir: d, pid: 100, isRunning: alive([]) });
  const b = acquireInstanceLock("prn_key", { dir: d, pid: 200, isRunning: alive([200]) });
  assert.equal(b.ok, true);
});

await test("a recycled PID that is NOT a print service doesn't block (image name checked)", () => {
  const d = dir();
  acquireInstanceLock("prn_key", { dir: d, pid: 100, imageName: "SohojPrintService.exe", isRunning: alive([]) });
  const isRunning = (pid, image) => pid === 100 && image === "chrome.exe"; // PID 100 is now Chrome
  assert.equal(acquireInstanceLock("prn_key", { dir: d, pid: 200, isRunning }).ok, true);
});

await test("release() frees it; a different key never conflicts; the key isn't in the file name", () => {
  const d = dir();
  const a = acquireInstanceLock("prn_secret", { dir: d, pid: 100, isRunning: alive([100]) });
  assert.equal(acquireInstanceLock("prn_other", { dir: d, pid: 300, isRunning: alive([100, 300]) }).ok, true);
  assert.ok(!fs.readdirSync(d).some((f) => f.includes("secret")));
  a.release();
  assert.equal(acquireInstanceLock("prn_secret", { dir: d, pid: 200, isRunning: alive([100, 200]) }).ok, true);
});

await test("a corrupt lock file is treated as stale", () => {
  const d = dir();
  const first = acquireInstanceLock("prn_key", { dir: d, pid: 100, isRunning: alive([100]) });
  fs.writeFileSync(first.file, "not json");
  assert.equal(acquireInstanceLock("prn_key", { dir: d, pid: 200, isRunning: alive([100, 200]) }).ok, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
