// test/waiterCall.test.js
// ─────────────────────────────────────────────────────────────────────────────
// "Call waiter" (services/waiterCallService.js): who is rung, the 3 min →
// 2 min → phone escalation, one live call per order, atomic ack/resolve, and
// the strict order-ownership check. No DB — in-memory fake. Run:
//   node test/waiterCall.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const {
  CALL_WINDOW_MS, pickTargets, orderWaiterId, getCallState, createCall, cancelCall,
  acknowledgeCall, resolveCall, listCallsForWaiter, assertCanCallForOrder,
} = await import("../services/waiterCallService.js");
const { signGuestOrderToken } = await import("../utils/guestOrderToken.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
};

// ── In-memory WaiterCall / AttendanceSession ─────────────────────────────────
const val = (v) => (v instanceof Date ? v.getTime() : v);
const matches = (doc, f) => Object.entries(f).every(([k, c]) => {
  const v = doc[k];
  if (k === "targets") return (v || []).map(String).includes(String(c));
  if (c && typeof c === "object" && !(c instanceof Date)) {
    return Object.entries(c).every(([op, x]) => (op === "$gt" ? v != null && val(v) > val(x) : (() => { throw new Error(op); })()));
  }
  return String(val(v)) === String(val(c));
});

const makeModels = ({ onDuty = [] } = {}) => {
  const calls = [];
  let n = 0;
  // single=true mimics findOne(): lean()/await give one document, not an array.
  const q = (rowsFn, single = false) => {
    const chain = {
      sort: (spec) => { const [[k, d]] = Object.entries(spec); const f = rowsFn; rowsFn = () => [...f()].sort((a, b) => (val(a[k]) - val(b[k])) * d); return chain; },
      lean: async () => {
        const rows = rowsFn().map((r) => ({ ...r }));
        return single ? rows[0] || null : rows;
      },
      then: (res, rej) => Promise.resolve(rowsFn()[0] ? { ...rowsFn()[0] } : null).then(res, rej),
    };
    return chain;
  };
  const WaiterCall = {
    calls,
    findOne: (f) => q(() => calls.filter((c) => matches(c, f)), true),
    find: (f) => q(() => calls.filter((c) => matches(c, f))),
    findById: (id) => ({ lean: async () => { const c = calls.find((x) => x._id === id); return c ? { ...c } : null; } }),
    exists: async (f) => calls.some((c) => matches(c, f)),
    create: async (doc) => {
      if (doc.active && calls.some((c) => String(c.order) === String(doc.order) && c.active)) {
        throw Object.assign(new Error("E11000"), { code: 11000 });
      }
      const row = { _id: `call${++n}`, createdAt: new Date(clock.now.getTime() + n), ...doc };
      calls.push(row);
      return { ...row };
    },
    updateOne: async (f, u) => { const c = calls.find((x) => matches(x, f)); if (c) Object.assign(c, u.$set); },
    findOneAndUpdate: async (f, u) => { const c = calls.find((x) => matches(x, f)); if (!c) return null; Object.assign(c, u.$set); return { ...c }; },
  };
  const AttendanceSession = { find: () => ({ select: () => ({ lean: async () => onDuty.map((e) => ({ employee: e })) }) }) };
  return { WaiterCall, AttendanceSession };
};

const clock = { now: new Date(Date.UTC(2026, 8, 30, 19, 0)) };
const at = (ms) => new Date(clock.now.getTime() + ms);
const order = (extra = {}) => ({ _id: "o1", orderId: "ORD7", orderType: "DINE_IN", tableNo: 4, status: "DELIVERED", guestName: "Asha", ...extra });

// ── Targets ──────────────────────────────────────────────────────────────────
await test("the order's waiter = who placed it, else who confirmed it (waiters only)", () => {
  assert.equal(orderWaiterId({ waiterId: "w1", confirmedBy: { role: "WAITER", id: "w2" } }), "w1");
  assert.equal(orderWaiterId({ confirmedBy: { role: "WAITER", id: "w2" } }), "w2");
  assert.equal(orderWaiterId({ confirmedBy: { role: "ADMIN", id: "a1" } }), null, "admin is never 'the waiter'");
  assert.equal(orderWaiterId({}), null);
});

await test("attempt 1 rings the order's waiter if on duty, else everyone on duty; attempt 2 rings everyone", () => {
  assert.deepEqual(pickTargets({ attempt: 1, orderWaiter: "w1", onDuty: ["w1", "w2"] }), ["w1"]);
  assert.deepEqual(pickTargets({ attempt: 1, orderWaiter: "w9", onDuty: ["w1", "w2"] }), ["w1", "w2"], "their waiter is off duty");
  assert.deepEqual(pickTargets({ attempt: 1, orderWaiter: null, onDuty: ["w1"] }), ["w1"]);
  assert.deepEqual(pickTargets({ attempt: 2, orderWaiter: "w1", onDuty: ["w1", "w2"] }), ["w1", "w2"]);
});

// ── Escalation ───────────────────────────────────────────────────────────────
await test("full escalation: call (3 min) → call again to all (2 min) → phone number", async () => {
  const models = makeModels({ onDuty: ["w1", "w2"] });
  const o = order({ waiterId: "w1" });

  let r = await createCall({ models, order: o, adminPhone: "9000000000", now: clock.now });
  assert.equal(r.created, true);
  assert.deepEqual(r.targets, ["w1"]);
  assert.equal(r.call.attempt, 1);
  assert.equal(new Date(r.call.expiresAt).getTime(), at(CALL_WINDOW_MS[1]).getTime());
  assert.equal(r.state.nextAction, "WAIT");
  assert.equal(r.state.adminPhone, undefined, "no phone number while a waiter is being rung");

  // Tapping again while it's live does NOT ring again.
  r = await createCall({ models, order: o, now: at(60_000) });
  assert.equal(r.created, false);
  assert.equal(models.WaiterCall.calls.length, 1);

  // 3 minutes pass unanswered.
  let s = await getCallState({ models, order: o, now: at(CALL_WINDOW_MS[1]) });
  assert.equal(s.call.status, "EXPIRED");
  assert.equal(s.nextAction, "CALL_AGAIN");

  r = await createCall({ models, order: o, now: at(CALL_WINDOW_MS[1] + 1000) });
  assert.equal(r.call.attempt, 2);
  assert.deepEqual(r.targets, ["w1", "w2"]);
  assert.equal(models.WaiterCall.calls[0].active, false, "first call closed");

  // 2 more minutes pass.
  const t2 = CALL_WINDOW_MS[1] + 1000 + CALL_WINDOW_MS[2];
  s = await getCallState({ models, order: o, adminPhone: "9000000000", now: at(t2) });
  assert.equal(s.nextAction, "PHONE");
  assert.equal(s.adminPhone, "9000000000");
  await assert.rejects(createCall({ models, order: o, adminPhone: "9000000000", now: at(t2 + 1000) }),
    (e) => e.statusCode === 409 && e.code === "CALL_RESTAURANT" && e.adminPhone === "9000000000");

  // Much later a fresh round is allowed again.
  s = await getCallState({ models, order: o, now: at(t2 + 11 * 60_000) });
  assert.equal(s.nextAction, "CALL");
});

await test("no waiter on duty: the call is logged but the phone number is shown right away", async () => {
  const models = makeModels({ onDuty: [] });
  const r = await createCall({ models, order: order(), adminPhone: "9000000000", now: clock.now });
  assert.deepEqual(r.targets, []);
  assert.equal(r.state.adminPhone, "9000000000");
});

await test("only dine-in orders that are open and paid-for (pay-first) can call", async () => {
  const models = makeModels({ onDuty: ["w1"] });
  await assert.rejects(createCall({ models, order: order({ orderType: "TAKEAWAY" }), now: clock.now }), (e) => e.statusCode === 400);
  await assert.rejects(createCall({ models, order: order({ status: "AWAITING_PAYMENT" }), now: clock.now }), (e) => e.statusCode === 409);
  await assert.rejects(createCall({ models, order: order({ status: "COMPLETED" }), now: clock.now }), (e) => e.statusCode === 409);
  await assert.rejects(createCall({ models, order: order({ status: "CANCELLED" }), now: clock.now }), (e) => e.statusCode === 409);
});

// ── Waiter actions ───────────────────────────────────────────────────────────
await test("ack: first waiter wins, second gets 409 naming who's on the way", async () => {
  const models = makeModels({ onDuty: ["w1", "w2"] });
  const { call } = await createCall({ models, order: order(), now: clock.now });
  const a = await acknowledgeCall({ models, callId: call._id, actor: { id: "w1", name: "Ravi" }, now: at(10_000) });
  assert.equal(a.status, "ACKNOWLEDGED");
  await assert.rejects(acknowledgeCall({ models, callId: call._id, actor: { id: "w2", name: "Mona" }, now: at(11_000) }),
    (e) => e.statusCode === 409 && /Ravi/.test(e.message));
  const s = await getCallState({ models, order: order(), now: at(12_000) });
  assert.equal(s.call.acknowledgedBy.name, "Ravi");
  assert.equal(s.nextAction, "WAIT");
});

await test("ack after the timer ran out is refused; resolve still works (late arrival)", async () => {
  const models = makeModels({ onDuty: ["w1"] });
  const { call } = await createCall({ models, order: order(), now: clock.now });
  await assert.rejects(acknowledgeCall({ models, callId: call._id, actor: { name: "Ravi" }, now: at(CALL_WINDOW_MS[1] + 1) }), (e) => e.statusCode === 409);
  const done = await resolveCall({ models, callId: call._id, actor: { name: "Ravi" }, now: at(CALL_WINDOW_MS[1] + 5) });
  assert.equal(done.status, "RESOLVED");
  const s = await getCallState({ models, order: order(), now: at(CALL_WINDOW_MS[1] + 10) });
  assert.equal(s.nextAction, "CALL", "after a resolved call the customer can call again normally");
  await assert.rejects(resolveCall({ models, callId: call._id, actor: {}, now: at(CALL_WINDOW_MS[1] + 20) }), (e) => e.statusCode === 409);
});

await test("customer can withdraw a live call; the waiter's list only shows live calls ringing them", async () => {
  const models = makeModels({ onDuty: ["w1", "w2"] });
  await createCall({ models, order: order({ waiterId: "w1" }), now: clock.now });
  assert.equal((await listCallsForWaiter({ models, userId: "w1", now: at(1000) })).length, 1);
  assert.equal((await listCallsForWaiter({ models, userId: "w2", now: at(1000) })).length, 0, "attempt 1 only rings w1");
  const c = await cancelCall({ models, order: order() });
  assert.equal(c.status, "CANCELLED");
  assert.equal((await listCallsForWaiter({ models, userId: "w1", now: at(2000) })).length, 0);
});

// ── Ownership ────────────────────────────────────────────────────────────────
await test("ownership: guest needs a valid order token; customer must own it; staff can't call", () => {
  const o = { _id: "o1", user: "u1" };
  const guest = { _id: "o2", user: null };
  const req = (user, token) => ({ user, headers: token ? { "x-guest-order-token": token } : {} });
  assert.throws(() => assertCanCallForOrder(req(null), guest, "customer"), (e) => e.statusCode === 403, "token-less guest");
  assert.throws(() => assertCanCallForOrder(req(null, signGuestOrderToken("o1")), guest, "customer"), (e) => e.statusCode === 403, "token for another order");
  assertCanCallForOrder(req(null, signGuestOrderToken("o2")), guest, "customer");
  assertCanCallForOrder(req({ _id: "u1" }), o, "customer");
  assert.throws(() => assertCanCallForOrder(req({ _id: "u2" }), o, "customer"), (e) => e.statusCode === 403);
  assert.throws(() => assertCanCallForOrder(req({ _id: "w1" }), o, "waiter"), (e) => e.statusCode === 403);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
