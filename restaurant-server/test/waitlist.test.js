// test/waitlist.test.js
import assert from "node:assert/strict";
import { addToWaitlist, seatWaitlistEntry, cancelWaitlistEntry } from "../services/waitlistService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

// ── Minimal fake models ─────────────────────────────────────────────────────
const makeFakeWaitlist = (entries) => ({
  create: async (doc) => { const e = { _id: `e${entries.length + 1}`, status: "WAITING", ...doc }; entries.push(e); return e; },
  findOneAndUpdate: async (filter, update) => {
    const idx = entries.findIndex((e) =>
      String(e._id) === String(filter._id) &&
      (filter.status?.$in ? filter.status.$in.includes(e.status) : e.status === filter.status));
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...update.$set };
    return entries[idx];
  },
});

const makeFakeTable = (table) => ({
  findOne: async (filter) => (table && table.tableNo === filter.tableNo ? table : null),
});

const run = async () => {
  console.log("── waitlist ─────────────────────────────────────");

  await test("rejects an entry with no name", async () => {
    const entries = [];
    await assert.rejects(
      () => addToWaitlist({ WaitlistEntry: makeFakeWaitlist(entries) }, { guestName: "", partySize: 2, actor: {} }),
      (err) => err.statusCode === 400
    );
  });

  await test("rejects a party size below 1", async () => {
    const entries = [];
    await assert.rejects(
      () => addToWaitlist({ WaitlistEntry: makeFakeWaitlist(entries) }, { guestName: "Ravi", partySize: 0, actor: {} }),
      (err) => err.statusCode === 400
    );
  });

  await test("cannot seat a party at an already-occupied table", async () => {
    const entries = [{ _id: "e1", status: "WAITING", guestName: "Priya", partySize: 2 }];
    const WaitlistEntry = makeFakeWaitlist(entries);
    const Table = makeFakeTable({ tableNo: 5, seats: 4, status: "Active", occupancyStatus: "OCCUPIED", _id: "t5" });
    await assert.rejects(
      () => seatWaitlistEntry({ WaitlistEntry, Table, TableSession: {} }, { entryId: "e1", tableNo: 5, actor: {} }),
      (err) => err.statusCode === 400 && err.code === "TABLE_OCCUPIED"
    );
  });

  await test("cannot seat the same entry twice (race guard)", async () => {
    const entries = [{ _id: "e2", status: "SEATED", guestName: "Amit", partySize: 3, tableNo: 2 }];
    const WaitlistEntry = makeFakeWaitlist(entries);
    const Table = makeFakeTable({ tableNo: 2, seats: 4, status: "Active", occupancyStatus: "AVAILABLE", _id: "t2" });
    await assert.rejects(
      () => seatWaitlistEntry({ WaitlistEntry, Table, TableSession: {} }, { entryId: "e2", tableNo: 2, actor: {} }),
      (err) => err.statusCode === 404
    );
  });

  await test("cancelling an already-seated entry fails", async () => {
    const entries = [{ _id: "e3", status: "SEATED", guestName: "Neha", partySize: 2, tableNo: 1 }];
    const WaitlistEntry = makeFakeWaitlist(entries);
    await assert.rejects(
      () => cancelWaitlistEntry({ WaitlistEntry }, "e3"),
      (err) => err.statusCode === 404
    );
  });

  await test("cancelling a waiting entry succeeds", async () => {
    const entries = [{ _id: "e4", status: "WAITING", guestName: "Sam", partySize: 2 }];
    const WaitlistEntry = makeFakeWaitlist(entries);
    const cancelled = await cancelWaitlistEntry({ WaitlistEntry }, "e4");
    assert.equal(cancelled.status, "CANCELLED");
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
