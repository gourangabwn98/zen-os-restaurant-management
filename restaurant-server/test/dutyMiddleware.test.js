// test/dutyMiddleware.test.js
// ─────────────────────────────────────────────────────────────────────────────
// requireWaiterOnDuty (middleware/dutyMiddleware.js) — the route-level gate
// behind the Waiter Duty ON/OFF system. Plain-Node, no framework, no live DB
// (fake AttendanceSession model + fake req/res/next). Run:
//   node test/dutyMiddleware.test.js
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { requireWaiterOnDuty } = await import("../middleware/dutyMiddleware.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.stack || err.message}`); }
};

const fakeAttendanceSession = (sessions) => ({
  findOne: async (filter) =>
    sessions.find((s) =>
      String(s.employee) === String(filter.employee) && s.status === filter.status
    ) || null,
});

const runMiddleware = async (req) => {
  let nextCalled = false;
  let statusCode = null, body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await requireWaiterOnDuty(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
};

await test("admin passes through untouched, regardless of duty status", async () => {
  const req = {
    user: { _id: "u1", isAdmin: true, role: "admin" },
    models: { AttendanceSession: fakeAttendanceSession([]) },
  };
  const { nextCalled, statusCode } = await runMiddleware(req);
  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
});

await test("chef passes through untouched", async () => {
  const req = {
    user: { _id: "u2", role: "chef" },
    models: { AttendanceSession: fakeAttendanceSession([]) },
  };
  const { nextCalled, statusCode } = await runMiddleware(req);
  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
});

await test("no user (guest/customer) passes through untouched", async () => {
  const req = { user: null, models: { AttendanceSession: fakeAttendanceSession([]) } };
  const { nextCalled, statusCode } = await runMiddleware(req);
  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
});

await test("waiter with NO attendance session at all is blocked 403", async () => {
  const req = {
    user: { _id: "w1", role: "waiter" },
    models: { AttendanceSession: fakeAttendanceSession([]) },
  };
  const { nextCalled, statusCode, body } = await runMiddleware(req);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(body.message, "You must be ON DUTY to perform this action.");
});

await test("waiter with only a CLOSED session (already ended duty) is blocked 403", async () => {
  const req = {
    user: { _id: "w2", role: "waiter" },
    models: { AttendanceSession: fakeAttendanceSession([
      { employee: "w2", status: "CLOSED", presenceStatus: "OFFLINE" },
    ]) },
  };
  const { nextCalled, statusCode, body } = await runMiddleware(req);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(body.message, "You must be ON DUTY to perform this action.");
});

await test("waiter ON BREAK (open session, not ONLINE) is blocked 403", async () => {
  const req = {
    user: { _id: "w3", role: "waiter" },
    models: { AttendanceSession: fakeAttendanceSession([
      { employee: "w3", status: "OPEN", presenceStatus: "BREAK" },
    ]) },
  };
  const { nextCalled, statusCode, body } = await runMiddleware(req);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(body.message, "You must be ON DUTY to perform this action.");
});

await test("waiter ONLINE (open + online session) passes through", async () => {
  const req = {
    user: { _id: "w4", role: "waiter" },
    models: { AttendanceSession: fakeAttendanceSession([
      { employee: "w4", status: "OPEN", presenceStatus: "ONLINE" },
    ]) },
  };
  const { nextCalled, statusCode } = await runMiddleware(req);
  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
});

await test("only matches THIS waiter's own session, not another employee's", async () => {
  const req = {
    user: { _id: "w5", role: "waiter" },
    models: { AttendanceSession: fakeAttendanceSession([
      { employee: "someone-else", status: "OPEN", presenceStatus: "ONLINE" },
    ]) },
  };
  const { nextCalled, statusCode } = await runMiddleware(req);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});

console.log("──────────────────────────────────────────────");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL TESTS PASSED");
