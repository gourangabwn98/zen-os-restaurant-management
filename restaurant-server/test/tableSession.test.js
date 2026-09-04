// test/tableSession.test.js
import assert from "node:assert/strict";
import { closeTableSession } from "../services/tableSessionService.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

// ── Minimal fake models ─────────────────────────────────────────────────────
const makeFakeModels = ({ sessionDoc, activeOrderCount }) => {
  const savedSessions = [];
  const updatedTables = [];

  const TableSession = {
    findById: async (id) => (String(id) === String(sessionDoc._id) ? { ...sessionDoc, save: async function () { savedSessions.push({ ...this }); } } : null),
  };
  const Order = {
    countDocuments: async () => activeOrderCount,
  };
  const Table = {
    updateOne: async (filter, update) => { updatedTables.push({ filter, update }); return { acknowledged: true }; },
  };

  return { TableSession, Order, Table, savedSessions, updatedTables };
};

const run = async () => {
  console.log("── table clearing ──────────────────────────────");

  await test("cannot clear a table with active (non-terminal) orders", async () => {
    const sessionDoc = { _id: "s1", status: "OPEN", orders: ["o1", "o2"], table: "t1" };
    const { TableSession, Order, Table } = makeFakeModels({ sessionDoc, activeOrderCount: 1 });
    await assert.rejects(
      () => closeTableSession({ TableSession, Order, Table, sessionId: "s1", actor: { role: "WAITER" } }),
      (err) => err.statusCode === 400 && err.code === "TABLE_HAS_ACTIVE_ORDERS"
    );
  });

  await test("clears successfully once all orders are terminal, and frees the table", async () => {
    const sessionDoc = { _id: "s2", status: "OPEN", orders: ["o1"], table: "t2" };
    const { TableSession, Order, Table, updatedTables } = makeFakeModels({ sessionDoc, activeOrderCount: 0 });
    const result = await closeTableSession({ TableSession, Order, Table, sessionId: "s2", actor: { role: "WAITER" } });
    assert.equal(result.status, "CLOSED");
    assert.equal(updatedTables.length, 1);
    assert.deepEqual(updatedTables[0].update, { $set: { occupancyStatus: "AVAILABLE" } });
  });

  await test("cannot clear an already-closed session", async () => {
    const sessionDoc = { _id: "s3", status: "CLOSED", orders: [], table: "t3" };
    const { TableSession, Order, Table } = makeFakeModels({ sessionDoc, activeOrderCount: 0 });
    await assert.rejects(
      () => closeTableSession({ TableSession, Order, Table, sessionId: "s3", actor: { role: "ADMIN" } }),
      (err) => err.statusCode === 400
    );
  });

  await test("404s on an unknown session id", async () => {
    const sessionDoc = { _id: "s4", status: "OPEN", orders: [], table: "t4" };
    const { TableSession, Order, Table } = makeFakeModels({ sessionDoc, activeOrderCount: 0 });
    await assert.rejects(
      () => closeTableSession({ TableSession, Order, Table, sessionId: "does-not-exist", actor: {} }),
      (err) => err.statusCode === 404
    );
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
