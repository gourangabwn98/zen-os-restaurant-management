// test/dutyHistory.test.js — Duty ON/OFF audit log (DutyHistory).
// No DB — plain fakes, same style as attendance.test.js.  node test/dutyHistory.test.js
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  startDuty, endDuty, startBreak, endBreak, recordHeartbeat, setEmployeeShift, listDutyHistory,
} from "../services/attendanceService.js";
import { resolveRange } from "../services/employeeService.js";
import { getModels } from "../config/getModels.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

// ── Fake AttendanceSession (enforces one OPEN session per employee) ─────────
const makeSessions = () => {
  const docs = new Map(); let seq = 0;
  const matches = (d, q) => Object.entries(q).every(([k, v]) => String(d[k]) === String(v));
  return {
    _docs: docs,
    findOne: async (q) => { for (const d of docs.values()) if (matches(d, q)) return { ...d }; return null; },
    find: async (q) => [...docs.values()].filter((d) => matches(d, q)).map((d) => ({ ...d })),
    findOneAndUpdate: async (q, u) => {
      for (const d of docs.values()) {
        if (!matches(d, q)) continue;
        if (u.$set) Object.assign(d, u.$set);
        if (u.$push) for (const [k, v] of Object.entries(u.$push)) d[k] = [...(d[k] || []), v];
        return { ...d };
      }
      return null;
    },
    updateOne: async (q, u) => { for (const d of docs.values()) if (matches(d, q)) { Object.assign(d, u.$set); return; } },
    create: async (data) => {
      for (const d of docs.values()) {
        if (String(d.employee) === String(data.employee) && d.status === "OPEN") {
          const err = new Error("duplicate key"); err.code = 11000; throw err;
        }
      }
      const doc = { _id: `s${++seq}`, breaks: [], totalBreakSeconds: 0, ...data };
      docs.set(doc._id, doc);
      return { ...doc };
    },
  };
};

// ── Fake DutyHistory: unique {session, action}, find/sort/skip/limit/lean, countDocuments ──
const makeHistory = () => {
  const rows = []; let seq = 0;
  const matches = (r, q) => Object.entries(q).every(([k, v]) => {
    if (k === "at") return r.at >= v.$gte && r.at <= v.$lte;
    return String(r[k]) === String(v);
  });
  return {
    rows,
    create: async (doc) => {
      if (rows.some((r) => String(r.session) === String(doc.session) && r.action === doc.action)) {
        const err = new Error("duplicate key"); err.code = 11000; throw err;
      }
      const row = { _id: `h${++seq}`, ...doc };
      rows.push(row);
      return row;
    },
    find: (q) => {
      let out = rows.filter((r) => matches(r, q));
      const chain = {
        sort: () => { out = [...out].sort((a, b) => b.at - a.at || (b._id > a._id ? 1 : -1)); return chain; },
        skip: (n) => { out = out.slice(n); return chain; },
        limit: (n) => { out = out.slice(0, n); return chain; },
        lean: async () => out,
      };
      return chain;
    },
    countDocuments: async (q) => rows.filter((r) => matches(r, q)).length,
  };
};

const RAHUL = { _id: "u_rahul", name: "Rahul", role: "waiter" };
const ADMIN = { id: "u_admin", role: "ADMIN", name: "Owner" };
const SELF = { id: "u_rahul", role: "WAITER", name: "Rahul" };
const selfStart = (AS, DH) => startDuty({ AttendanceSession: AS, DutyHistory: DH, actor: SELF, employeeId: RAHUL._id, role: "waiter", employeeName: "Rahul" });
const selfEnd = (AS, DH) => endDuty({ AttendanceSession: AS, DutyHistory: DH, actor: SELF, employeeId: RAHUL._id });
const adminSet = (AS, DH, state) => setEmployeeShift({ AttendanceSession: AS, DutyHistory: DH, employee: RAHUL, state, actor: ADMIN });
const wholeDay = { start: new Date(0), end: new Date(8.64e15) };

const run = async () => {
  console.log("── Duty history ─────────────────────────────────────────────");

  await test("employee OFF → ON: session open + ON_DUTY record by SELF", async () => {
    const AS = makeSessions(), DH = makeHistory();
    const { session } = await selfStart(AS, DH);
    assert.equal(session.status, "OPEN");
    assert.equal(DH.rows.length, 1);
    const r = DH.rows[0];
    assert.equal(r.action, "ON_DUTY");
    assert.equal(r.source, "SELF");
    assert.equal(r.changedBy.name, "Rahul");
    assert.equal(r.changedBy.role, "WAITER");
    assert.equal(r.employeeName, "Rahul");
    assert.equal(r.employeeRole, "waiter");
    assert.equal(+r.at, +session.loginAt);
  });

  await test("employee ON → OFF: session closed + OFF_DUTY record by SELF at logoutAt", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);
    const closed = await selfEnd(AS, DH);
    assert.equal(closed.status, "CLOSED");
    assert.equal(DH.rows[1].action, "OFF_DUTY");
    assert.equal(DH.rows[1].source, "SELF");
    assert.equal(+DH.rows[1].at, +closed.logoutAt);
  });

  await test("admin ON → OFF: OFF_DUTY record by ADMIN, target employee is Rahul", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);
    const r = await adminSet(AS, DH, "OFF_SHIFT");
    assert.equal(r.changed, true);
    assert.equal((await AS.findOne({ employee: RAHUL._id, status: "OPEN" })), null);
    const off = DH.rows[1];
    assert.equal(off.action, "OFF_DUTY");
    assert.equal(off.source, "ADMIN");
    assert.equal(off.changedBy.name, "Owner");
    assert.equal(off.changedBy.role, "ADMIN");
    assert.equal(String(off.employee), RAHUL._id);
    assert.equal(off.employeeName, "Rahul");
  });

  await test("admin OFF → ON: ON_DUTY record by ADMIN", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await adminSet(AS, DH, "ON_SHIFT");
    assert.ok(await AS.findOne({ employee: RAHUL._id, status: "OPEN" }));
    assert.equal(DH.rows.length, 1);
    assert.equal(DH.rows[0].action, "ON_DUTY");
    assert.equal(DH.rows[0].source, "ADMIN");
  });

  await test("ON, OFF, ON, OFF, ON (mixed self/admin) → 5 separate records, none overwritten", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);
    await adminSet(AS, DH, "OFF_SHIFT");
    await selfStart(AS, DH);
    await selfEnd(AS, DH);
    await adminSet(AS, DH, "ON_SHIFT");
    assert.deepEqual(DH.rows.map((r) => `${r.action}:${r.source}`), [
      "ON_DUTY:SELF", "OFF_DUTY:ADMIN", "ON_DUTY:SELF", "OFF_DUTY:SELF", "ON_DUTY:ADMIN",
    ]);
  });

  await test("ON → ON (already on duty) creates no duplicate record", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);
    const again = await selfStart(AS, DH);
    assert.equal(again.resumed, true);
    const adminAgain = await adminSet(AS, DH, "ON_SHIFT");
    assert.equal(adminAgain.changed, false);
    assert.equal(DH.rows.length, 1);
  });

  await test("OFF → OFF creates no record (refused end, admin no-op)", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await assert.rejects(selfEnd(AS, DH), (e) => e.statusCode === 409);
    const r = await adminSet(AS, DH, "OFF_SHIFT");
    assert.equal(r.changed, false);
    assert.equal(DH.rows.length, 0);
  });

  await test("break start/end and heartbeats are not duty changes — no records", async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);
    await startBreak({ AttendanceSession: AS, employeeId: RAHUL._id });
    await endBreak({ AttendanceSession: AS, employeeId: RAHUL._id });
    await recordHeartbeat({ AttendanceSession: AS, employeeId: RAHUL._id });
    await adminSet(AS, DH, "ON_BREAK");
    await adminSet(AS, DH, "ON_SHIFT");
    assert.equal(DH.rows.length, 1);
    assert.equal((await AS.findOne({ employee: RAHUL._id, status: "OPEN" })).status, "OPEN");
  });

  await test("a retried write for the same transition is swallowed (unique session+action)", async () => {
    const AS = makeSessions(), DH = makeHistory();
    const { session } = await selfStart(AS, DH);
    await DH.create({ session: session._id, action: "ON_DUTY" }).catch((e) => assert.equal(e.code, 11000));
    assert.equal(DH.rows.length, 1);
  });

  await test("a failing history write never undoes the duty change", async () => {
    const AS = makeSessions();
    const broken = { create: async () => { throw new Error("db down"); } };
    const origErr = console.error; console.error = () => {};
    try {
      const { session } = await startDuty({ AttendanceSession: AS, DutyHistory: broken, actor: SELF, employeeId: RAHUL._id, role: "waiter" });
      assert.equal(session.status, "OPEN");
    } finally { console.error = origErr; }
  });

  // ── listDutyHistory: server-side filters + summary ────────────────────────
  const seeded = async () => {
    const AS = makeSessions(), DH = makeHistory();
    await selfStart(AS, DH);                // Rahul ON  self
    await adminSet(AS, DH, "OFF_SHIFT");    // Rahul OFF admin
    await selfStart(AS, DH);                // Rahul ON  self
    await selfEnd(AS, DH);                  // Rahul OFF self
    await startDuty({ AttendanceSession: AS, DutyHistory: DH, actor: ADMIN, employeeId: "u_amit", role: "waiter", employeeName: "Amit" }); // Amit ON admin
    return DH;
  };

  await test("summary counts ON/OFF and self/admin over the whole filtered set", async () => {
    const DH = await seeded();
    const r = await listDutyHistory({ DutyHistory: DH, ...wholeDay });
    assert.equal(r.total, 5);
    assert.deepEqual(r.summary, { total: 5, onDuty: 3, offDuty: 2, bySelf: 3, byAdmin: 2 });
  });

  await test("employee filter → only that employee", async () => {
    const DH = await seeded();
    const r = await listDutyHistory({ DutyHistory: DH, ...wholeDay, employeeId: RAHUL._id });
    assert.equal(r.total, 4);
    assert.ok(r.records.every((x) => String(x.employee) === RAHUL._id));
    assert.deepEqual(r.summary, { total: 4, onDuty: 2, offDuty: 2, bySelf: 3, byAdmin: 1 });
  });

  await test("action filter OFF_DUTY → only OFF records", async () => {
    const DH = await seeded();
    const r = await listDutyHistory({ DutyHistory: DH, ...wholeDay, action: "OFF_DUTY" });
    assert.equal(r.total, 2);
    assert.ok(r.records.every((x) => x.action === "OFF_DUTY"));
    assert.equal(r.summary.onDuty, 0);
  });

  await test("changed-by filter ADMIN → only admin changes", async () => {
    const DH = await seeded();
    const r = await listDutyHistory({ DutyHistory: DH, ...wholeDay, source: "ADMIN" });
    assert.equal(r.total, 2);
    assert.ok(r.records.every((x) => x.source === "ADMIN"));
    assert.equal(r.summary.bySelf, 0);
  });

  await test("unknown filter values are ignored, not trusted", async () => {
    const DH = await seeded();
    const r = await listDutyHistory({ DutyHistory: DH, ...wholeDay, action: "DELETE", source: { $ne: 1 } });
    assert.equal(r.total, 5);
  });

  await test("date range excludes other days; paging caps the page, not the summary", async () => {
    const DH = makeHistory();
    const mk = (id, iso) => DH.create({ session: id, action: "ON_DUTY", source: "SELF", employee: "e", at: new Date(iso) });
    await mk("a", "2026-10-06T18:29:00Z"); // 06 Oct 23:59 IST — yesterday
    await mk("b", "2026-10-06T18:31:00Z"); // 07 Oct 00:01 IST — today
    await mk("c", "2026-10-07T12:00:00Z"); // 07 Oct 17:30 IST
    await mk("d", "2026-10-07T18:31:00Z"); // 08 Oct 00:01 IST — tomorrow
    const { start, end } = resolveRange("2026-10-07", "2026-10-07", "Asia/Kolkata");
    const r = await listDutyHistory({ DutyHistory: DH, start, end, limit: 1 });
    assert.equal(r.total, 2);
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].session, "c"); // newest first
  });

  // ── Restaurant (IST) calendar day, not UTC ─────────────────────────────────
  await test("07 Oct 2026 in Asia/Kolkata = 06 Oct 18:30Z → 07 Oct 18:29:59.999Z", async () => {
    const { start, end } = resolveRange("2026-10-07", "2026-10-07", "Asia/Kolkata");
    assert.equal(start.toISOString(), "2026-10-06T18:30:00.000Z");
    assert.equal(end.toISOString(), "2026-10-07T18:29:59.999Z");
  });

  // ── Schema: audit records are read-only through the app ──────────────────
  await test("DutyHistory model blocks updates/deletes and has the idempotency index", async () => {
    const conn = mongoose.createConnection(); // never opened
    const { DutyHistory } = getModels(conn);
    await assert.rejects(DutyHistory.updateOne({}, { $set: { action: "OFF_DUTY" } }).exec(), /read-only/);
    await assert.rejects(DutyHistory.deleteMany({}).exec(), /read-only/);
    await assert.rejects(DutyHistory.findOneAndUpdate({}, { $set: { source: "SELF" } }).exec(), /read-only/);
    const idx = DutyHistory.schema.indexes().find(([keys]) => keys.session === 1 && keys.action === 1);
    assert.ok(idx && idx[1].unique);
    await conn.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
};

run();
