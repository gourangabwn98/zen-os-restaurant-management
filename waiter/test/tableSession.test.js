// Plain Node + assert, no test runner — run with:
//   node test/tableSession.test.js
import assert from "node:assert/strict";
import {
  activeOrders, priorityStatus, paymentState, runningTotal, earliestOrderTime,
  elapsedMinutes, formatElapsed, elapsedKind, classifyTable, summarize, filterMatches,
} from "../src/utils/tableSession.js";

// ── priorityStatus ───────────────────────────────────────────────────────
assert.equal(priorityStatus([{ status: "PREPARING" }, { status: "PENDING_CONFIRMATION" }]), "PENDING_CONFIRMATION");
assert.equal(priorityStatus([{ status: "PREPARING" }, { status: "READY" }]), "READY");
assert.equal(priorityStatus([{ status: "PREPARING" }, { status: "CONFIRMED" }]), "CONFIRMED");
assert.equal(priorityStatus([{ status: "DELIVERED" }, { status: "PREPARING" }]), "PREPARING");
assert.equal(priorityStatus([{ status: "DELIVERED" }]), "DELIVERED");
assert.equal(priorityStatus([{ status: "COMPLETED" }]), null); // not an active status
assert.equal(priorityStatus([]), null);

// ── paymentState ─────────────────────────────────────────────────────────
assert.equal(paymentState([{ status: "CONFIRMED", paymentStatus: "PENDING_VERIFICATION" }]), "due");
assert.equal(paymentState([{ status: "CONFIRMED", paymentStatus: "PAID" }]), "paid");
assert.equal(
  paymentState([{ status: "CONFIRMED", paymentStatus: "PAID" }, { status: "PREPARING", paymentStatus: "PENDING_VERIFICATION" }]),
  "due"
);
assert.equal(paymentState([{ status: "CONFIRMED", paymentStatus: "FAILED" }]), "open");
assert.equal(paymentState([]), null);

// ── formatElapsed ────────────────────────────────────────────────────────
assert.equal(formatElapsed(12), "12m");
assert.equal(formatElapsed(194), "3h 14m");
assert.equal(formatElapsed(4737), "78h 57m");
assert.equal(formatElapsed(null), null);

// ── elapsedKind (45/120 minute thresholds) ──────────────────────────────
assert.equal(elapsedKind(10), "normal");
assert.equal(elapsedKind(44), "normal");
assert.equal(elapsedKind(45), "wait");
assert.equal(elapsedKind(120), "wait");
assert.equal(elapsedKind(121), "stop");
assert.equal(elapsedKind(null), "normal");

// ── elapsedMinutes ───────────────────────────────────────────────────────
assert.equal(elapsedMinutes(null), null);
assert.equal(elapsedMinutes(1000, 1000 + 90_000), 1); // 90s → 1 whole minute

// ── activeOrders / runningTotal / earliestOrderTime ─────────────────────
assert.equal(activeOrders(null).length, 0);
assert.equal(
  runningTotal([{ status: "CONFIRMED", total: 100 }, { status: "COMPLETED", total: 999 }]),
  100
);
assert.equal(earliestOrderTime([]), null);
{
  const now = Date.now();
  const t1 = now - 60_000, t2 = now - 120_000;
  const earliest = earliestOrderTime([
    { status: "CONFIRMED", createdAt: new Date(t1).toISOString() },
    { status: "PREPARING", createdAt: new Date(t2).toISOString() },
  ]);
  assert.equal(earliest, t2);
}

// ── classifyTable / summarize — the "always shows 10/10 occupied" fix ───
// Occupied must come from each table's own ACTIVE orders, never a stale
// table.occupancyStatus flag — a table whose only order is COMPLETED reads
// as free here even if the backend's flag says otherwise.
{
  const tables = [{ tableNo: 1, seats: 2 }, { tableNo: 2, seats: 4 }, { tableNo: 3, seats: 4 }];
  const sessions = {
    1: { orders: [{ status: "CONFIRMED", total: 200, paymentStatus: "PENDING_VERIFICATION", createdAt: new Date().toISOString() }] },
    2: { orders: [{ status: "COMPLETED", total: 500, paymentStatus: "PAID", createdAt: new Date().toISOString() }] },
    // table 3 has no session at all
  };
  const classified = tables.map((t) => classifyTable(t, sessions[t.tableNo]));
  assert.equal(classified[0].occupied, true);
  assert.equal(classified[1].occupied, false); // only a COMPLETED order → free
  assert.equal(classified[2].occupied, false); // no session → free

  const s = summarize(classified);
  assert.equal(s.occupied, 1);
  assert.equal(s.free, 2);
  assert.equal(s.total, 3);
  assert.equal(s.toCollect, 200);
  assert.equal(s.due, 1);
  assert.equal(s.needsYou, 0); // CONFIRMED is neither PENDING_CONFIRMATION nor READY
}

// ── filterMatches ─────────────────────────────────────────────────────────
{
  const occDue    = { occupied: true,  status: "READY",                 payment: "due" };
  const occNoPay  = { occupied: true,  status: "PREPARING",             payment: "open" };
  const free      = { occupied: false, status: null,                    payment: null };
  const needsYou1 = { occupied: true,  status: "PENDING_CONFIRMATION",  payment: "open" };

  assert.equal(filterMatches("ALL", occDue), true);
  assert.equal(filterMatches("FREE", free), true);
  assert.equal(filterMatches("FREE", occDue), false);
  assert.equal(filterMatches("OCCUPIED", occDue), true);
  assert.equal(filterMatches("OCCUPIED", free), false);
  assert.equal(filterMatches("DUE", occDue), true);
  assert.equal(filterMatches("DUE", occNoPay), false);
  assert.equal(filterMatches("NEEDS_YOU", occDue), true); // READY
  assert.equal(filterMatches("NEEDS_YOU", needsYou1), true); // PENDING_CONFIRMATION
  assert.equal(filterMatches("NEEDS_YOU", occNoPay), false); // PREPARING
}

console.log("tableSession.test.js: all assertions passed");
