// test/printStale.test.js — dropping stale waiting print jobs (services/printerDeviceService.js).
//   node test/printStale.test.js
import assert from "node:assert/strict";
import { staleCutoff, skipStalePrintJobs, STALE_MIN_MINUTES, expireOldPrintJobs, AUTO_EXPIRE_MINUTES } from "../services/printerDeviceService.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const now = new Date("2026-10-05T12:00:00Z");
const minsAgo = (m) => new Date(now.getTime() - m * 60000);

// Minimal fake of Model.updateMany honouring { status: {$in}, createdAt: {$lt} }.
const fakeModel = (docs) => ({
  docs,
  async updateMany(filter, update) {
    let n = 0;
    for (const d of docs) {
      if (filter.status.$in.includes(d.status) && d.createdAt < filter.createdAt.$lt) { Object.assign(d, update.$set); n++; }
    }
    return { modifiedCount: n };
  },
});

await test("cutoff never goes below the minimum, defaults to 60", () => {
  assert.equal(staleCutoff(1, now).minutes, STALE_MIN_MINUTES);
  assert.equal(staleCutoff("abc", now).minutes, 60);
  assert.equal(staleCutoff(90, now).cutoff.getTime(), minsAgo(90).getTime());
});

await test("only old WAITING jobs are skipped — recent, printing and printed ones are untouched", async () => {
  const KOTJob = fakeModel([
    { id: "old-pending", status: "PENDING", createdAt: minsAgo(600) },
    { id: "old-failed", status: "FAILED", createdAt: minsAgo(120) },
    { id: "new-pending", status: "PENDING", createdAt: minsAgo(5) },
    { id: "old-printing", status: "PRINTING", createdAt: minsAgo(600) },
    { id: "old-printed", status: "PRINTED", createdAt: minsAgo(600) },
  ]);
  const BillPrintJob = fakeModel([{ id: "old-bill", status: "PENDING", createdAt: minsAgo(61) }]);
  const r = await skipStalePrintJobs({ KOTJob, BillPrintJob, olderThanMinutes: 60, actor: { name: "Owner" }, now });
  assert.deepEqual(r, { kot: 2, bill: 1, minutes: 60 });
  const st = Object.fromEntries(KOTJob.docs.map((d) => [d.id, d.status]));
  assert.deepEqual(st, { "old-pending": "SKIPPED", "old-failed": "SKIPPED", "new-pending": "PENDING", "old-printing": "PRINTING", "old-printed": "PRINTED" });
  assert.match(KOTJob.docs[0].lastError, /Owner/);
});

await test("clear queue (all) drops every waiting job, whatever its age", async () => {
  const KOTJob = fakeModel([
    { id: "new-pending", status: "PENDING", createdAt: minsAgo(1) },
    { id: "printing", status: "PRINTING", createdAt: minsAgo(1) },
  ]);
  const BillPrintJob = fakeModel([{ id: "new-bill", status: "FAILED", createdAt: minsAgo(2) }]);
  const r = await skipStalePrintJobs({ KOTJob, BillPrintJob, all: true, actor: { name: "Owner" }, now });
  assert.deepEqual(r, { kot: 1, bill: 1, minutes: 0 });
  assert.equal(KOTJob.docs[1].status, "PRINTING");
});

await test("auto-expiry drops jobs older than the limit (incl. stuck PRINTING), keeps recent ones", async () => {
  const KOTJob = fakeModel([
    { id: "old", status: "PENDING", createdAt: minsAgo(AUTO_EXPIRE_MINUTES + 1) },
    { id: "stuck", status: "PRINTING", createdAt: minsAgo(300) },
    { id: "recent", status: "PENDING", createdAt: minsAgo(AUTO_EXPIRE_MINUTES - 1) },
    { id: "done", status: "PRINTED", createdAt: minsAgo(300) },
  ]);
  const BillPrintJob = fakeModel([{ id: "old-bill", status: "FAILED", createdAt: minsAgo(600) }]);
  const KOTChangeJob = fakeModel([{ id: "old-slip", status: "PENDING", createdAt: minsAgo(600) }]);
  const r = await expireOldPrintJobs({ KOTJob, BillPrintJob, KOTChangeJob, now });
  assert.deepEqual(r, { kot: 3, bill: 1 });
  assert.deepEqual(KOTJob.docs.map((d) => d.status), ["SKIPPED", "SKIPPED", "PENDING", "PRINTED"]);
});

console.log(`\n${passed} passed`);
