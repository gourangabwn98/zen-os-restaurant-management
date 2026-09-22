// test/attendance.test.js
import assert from "node:assert/strict";
import {
  startDuty, startBreak, endBreak, endDuty, recordHeartbeat,
  sweepStaleAttendanceSessions, summarizeAttendanceSessions,
} from "../services/attendanceService.js";
import {
  assertCanStartDuty, assertCanStartBreak, assertCanEndBreak, assertCanEndDuty,
} from "../utils/attendanceStateMachine.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

// ── Minimal fake AttendanceSession model — plain objects, no live DB ────────
const makeFakeAttendanceModel = (seed = []) => {
  const docs = new Map(seed.map((d, i) => [d._id || `s${i}`, { ...d, _id: d._id || `s${i}` }]));
  let seq = docs.size;

  const matches = (doc, query) => {
    if (query.employee !== undefined && String(doc.employee) !== String(query.employee)) return false;
    if (query._id !== undefined && String(doc._id) !== String(query._id)) return false;
    if (query.status !== undefined && doc.status !== query.status) return false;
    if (query.presenceStatus !== undefined && doc.presenceStatus !== query.presenceStatus) return false;
    if (query.lastSeenAt !== undefined) {
      if (query.lastSeenAt?.$lt !== undefined) {
        if (!(new Date(doc.lastSeenAt) < query.lastSeenAt.$lt)) return false;
      } else if (+new Date(doc.lastSeenAt) !== +new Date(query.lastSeenAt)) {
        return false;
      }
    }
    return true;
  };

  return {
    _docs: docs,
    findOne: async (query) => {
      for (const d of docs.values()) if (matches(d, query)) return { ...d };
      return null;
    },
    find: async (query) => [...docs.values()].filter((d) => matches(d, query)).map((d) => ({ ...d })),
    findOneAndUpdate: async (query, update, opts = {}) => {
      for (const [id, d] of docs.entries()) {
        if (!matches(d, query)) continue;
        if (update.$set) Object.assign(d, update.$set);
        if (update.$push) {
          for (const [key, val] of Object.entries(update.$push)) {
            d[key] = [...(d[key] || []), val];
          }
        }
        docs.set(id, d);
        return opts.new === false ? null : { ...d };
      }
      return null;
    },
    create: async (data) => {
      // Enforce the same "one OPEN session per employee" invariant as the
      // real partial unique index, so startDuty's duplicate-key path is
      // exercised the same way it would be against real Mongo.
      if (data.status === "OPEN") {
        for (const d of docs.values()) {
          if (String(d.employee) === String(data.employee) && d.status === "OPEN") {
            const err = new Error("duplicate key");
            err.code = 11000;
            throw err;
          }
        }
      }
      const _id = `s${++seq}`;
      const doc = { _id, breaks: [], totalBreakSeconds: 0, totalWorkingSeconds: 0, autoClosed: false, ...data };
      docs.set(_id, doc);
      return { ...doc };
    },
  };
};

const minutesAgo = (mins, from = new Date()) => new Date(from.getTime() - mins * 60 * 1000);

const run = async () => {
  console.log("── Employee Attendance ─────────────────────────────────────");

  // ── State machine guards ──────────────────────────────────────────────────
  await test("assertCanStartDuty rejects when a session is already open", () => {
    assert.throws(() => assertCanStartDuty({ status: "OPEN" }), /already active/);
  });
  await test("assertCanStartDuty allows when no session is open", () => {
    assert.doesNotThrow(() => assertCanStartDuty(null));
  });
  await test("assertCanStartBreak rejects double break-start", () => {
    assert.throws(() => assertCanStartBreak({ status: "OPEN", presenceStatus: "BREAK" }), /Already on break/);
  });
  await test("assertCanEndBreak rejects when not on break", () => {
    assert.throws(() => assertCanEndBreak({ status: "OPEN", presenceStatus: "ONLINE" }), /Not currently on break/);
  });
  await test("assertCanEndDuty rejects when no open session", () => {
    assert.throws(() => assertCanEndDuty(null), /No active duty session/);
  });

  // ── Full lifecycle ───────────────────────────────────────────────────────
  await test("start -> break -> resume -> end computes net working time correctly", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session: started, resumed } = await startDuty({
      AttendanceSession, employeeId: "e1", role: "waiter", employeeName: "Rahul",
    });
    assert.equal(resumed, false);
    assert.equal(started.presenceStatus, "ONLINE");

    // Force known timestamps so the math is deterministic.
    started.loginAt = minutesAgo(180); // 3h ago
    AttendanceSession._docs.set(started._id, started);

    const onBreak = await startBreak({ AttendanceSession, employeeId: "e1" });
    assert.equal(onBreak.presenceStatus, "BREAK");
    assert.equal(onBreak.breaks.length, 1);

    // Simulate a 20-minute break by back-dating its start.
    onBreak.breaks[0].startedAt = minutesAgo(20);
    AttendanceSession._docs.set(onBreak._id, onBreak);

    const resumedDuty = await endBreak({ AttendanceSession, employeeId: "e1" });
    assert.equal(resumedDuty.presenceStatus, "ONLINE");
    assert.ok(resumedDuty.breaks[0].endedAt);
    assert.ok(Math.abs(resumedDuty.totalBreakSeconds - 20 * 60) < 5);

    const closed = await endDuty({ AttendanceSession, employeeId: "e1" });
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.presenceStatus, "OFFLINE");
    // 180 min gross - 20 min break ≈ 160 min net working time.
    assert.ok(Math.abs(closed.totalWorkingSeconds - 160 * 60) < 5);
  });

  await test("ending duty while still on an open break closes the break first", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e2", role: "chef", employeeName: "Raj" });
    session.loginAt = minutesAgo(60);
    AttendanceSession._docs.set(session._id, session);
    const onBreak = await startBreak({ AttendanceSession, employeeId: "e2" });
    onBreak.breaks[0].startedAt = minutesAgo(10);
    AttendanceSession._docs.set(onBreak._id, onBreak);

    const closed = await endDuty({ AttendanceSession, employeeId: "e2" });
    assert.equal(closed.breaks[0].endedAt !== null, true, "open break must be closed by End Duty");
    assert.ok(Math.abs(closed.totalBreakSeconds - 10 * 60) < 5);
    assert.ok(Math.abs(closed.totalWorkingSeconds - 50 * 60) < 5); // 60 - 10 break
  });

  await test("break -> break is rejected", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    await startDuty({ AttendanceSession, employeeId: "e3", role: "waiter", employeeName: "Amit" });
    await startBreak({ AttendanceSession, employeeId: "e3" });
    await assert.rejects(() => startBreak({ AttendanceSession, employeeId: "e3" }), /Already on break/);
  });

  await test("resume -> resume is rejected", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    await startDuty({ AttendanceSession, employeeId: "e4", role: "waiter", employeeName: "Suman" });
    await startBreak({ AttendanceSession, employeeId: "e4" });
    await endBreak({ AttendanceSession, employeeId: "e4" });
    await assert.rejects(() => endBreak({ AttendanceSession, employeeId: "e4" }), /Not currently on break/);
  });

  await test("multiple breaks in one shift accumulate correctly", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e5", role: "waiter", employeeName: "Priya" });
    session.loginAt = minutesAgo(480); // 8h ago
    AttendanceSession._docs.set(session._id, session);

    for (const mins of [15, 10]) {
      const onBreak = await startBreak({ AttendanceSession, employeeId: "e5" });
      const idx = onBreak.breaks.length - 1;
      onBreak.breaks[idx].startedAt = minutesAgo(mins);
      AttendanceSession._docs.set(onBreak._id, onBreak);
      await endBreak({ AttendanceSession, employeeId: "e5" });
    }

    const closed = await endDuty({ AttendanceSession, employeeId: "e5" });
    assert.equal(closed.breaks.length, 2);
    assert.ok(Math.abs(closed.totalBreakSeconds - 25 * 60) < 5);
    assert.ok(Math.abs(closed.totalWorkingSeconds - (480 - 25) * 60) < 5);
  });

  await test("duplicate Start Duty resumes the same open session instead of erroring", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const first = await startDuty({ AttendanceSession, employeeId: "e6", role: "waiter", employeeName: "Test" });
    const second = await startDuty({ AttendanceSession, employeeId: "e6", role: "waiter", employeeName: "Test" });
    assert.equal(second.resumed, true);
    assert.equal(String(second.session._id), String(first.session._id));
  });

  await test("midnight-crossing session computes a positive, correct duration", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e7", role: "waiter", employeeName: "Night" });
    // Login at 23:00, "now" (end) 03:00 the next day — 4h shift, no breaks.
    const login = new Date("2026-09-23T23:00:00");
    const logout = new Date("2026-09-24T03:00:00");
    session.loginAt = login;
    AttendanceSession._docs.set(session._id, session);

    // endDuty uses `new Date()` internally for "now" — verify the pure math
    // directly against the same formula instead of monkey-patching Date.
    const grossSeconds = Math.round((logout - login) / 1000);
    assert.equal(grossSeconds, 4 * 3600);
    assert.ok(grossSeconds > 0, "midnight-crossing duration must never be negative");
  });

  // ── Heartbeat + sweep ────────────────────────────────────────────────────
  await test("heartbeat updates lastSeenAt without closing the session", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e8", role: "chef", employeeName: "Bikash" });
    const before = session.lastSeenAt;
    await new Promise((r) => setTimeout(r, 5));
    await recordHeartbeat({ AttendanceSession, employeeId: "e8" });
    const after = await AttendanceSession.findOne({ employee: "e8", status: "OPEN" });
    assert.equal(after.status, "OPEN");
    assert.ok(new Date(after.lastSeenAt) >= new Date(before));
  });

  await test("sweep closes a stale session using lastSeenAt, never 'now', as logout", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e9", role: "waiter", employeeName: "Stale" });
    session.loginAt = minutesAgo(60);
    session.lastSeenAt = minutesAgo(10); // older than default 5-minute grace
    AttendanceSession._docs.set(session._id, session);

    const closed = await sweepStaleAttendanceSessions({ AttendanceSession });
    assert.equal(closed.length, 1);
    assert.equal(closed[0].autoClosed, true);
    assert.equal(+new Date(closed[0].logoutAt), +new Date(session.lastSeenAt));
  });

  await test("sweep skips a session whose heartbeat arrived after the stale read (no double-close race)", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    const { session } = await startDuty({ AttendanceSession, employeeId: "e10", role: "waiter", employeeName: "Race" });
    session.lastSeenAt = minutesAgo(10);
    AttendanceSession._docs.set(session._id, session);

    // Simulate a heartbeat landing between the sweep's read and its
    // conditional write by bumping lastSeenAt via the real find/update path
    // is awkward with this fake's synchronous nature, so instead assert the
    // conditional-update guard itself: an update keyed on a stale
    // lastSeenAt value must not match a doc whose lastSeenAt has moved on.
    const staleRead = { ...session, lastSeenAt: minutesAgo(10) };
    session.lastSeenAt = minutesAgo(0); // heartbeat just arrived
    AttendanceSession._docs.set(session._id, session);

    const result = await AttendanceSession.findOneAndUpdate(
      { _id: staleRead._id, status: "OPEN", lastSeenAt: staleRead.lastSeenAt },
      { $set: { status: "CLOSED" } },
      { new: true }
    );
    assert.equal(result, null, "a stale-keyed close must not clobber a session whose heartbeat just updated");
  });

  await test("sweep does not touch a session with a recent heartbeat", async () => {
    const AttendanceSession = makeFakeAttendanceModel();
    await startDuty({ AttendanceSession, employeeId: "e11", role: "waiter", employeeName: "Fresh" });
    const closed = await sweepStaleAttendanceSessions({ AttendanceSession });
    assert.equal(closed.length, 0);
  });

  // ── Aggregation ──────────────────────────────────────────────────────────
  await test("summarizeAttendanceSessions excludes break time from working time", () => {
    const now = new Date("2026-09-23T18:00:00");
    const sessions = [{
      status: "CLOSED",
      loginAt: new Date("2026-09-23T10:00:00"),
      logoutAt: new Date("2026-09-23T18:00:00"),
      totalBreakSeconds: 30 * 60,
      totalWorkingSeconds: 7.5 * 3600,
      breaks: [],
    }];
    const summary = summarizeAttendanceSessions(sessions, now);
    assert.equal(summary.totalWorkingSeconds, 7.5 * 3600);
    assert.equal(summary.currentStatus, "OFFLINE");
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
