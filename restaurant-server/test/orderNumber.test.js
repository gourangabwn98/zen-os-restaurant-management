// test/orderNumber.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Plain-Node assertion tests (no framework, no live MongoDB) for the atomic
// order-number generator that replaced the racy countDocuments()+1 pre-save
// hook. Run with:  node test/orderNumber.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { formatOrderId, nextOrderId, ORDER_NUMBER_KEY } from "../utils/orderNumber.js";

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error(`         ${err.message}`); }
};

// ── In-memory fakes mimicking the tiny slice of the Mongoose API we use ──────
const makeFakeCounter = (initialDocs = {}) => {
  const docs = { ...initialDocs }; // _id -> { _id, seq }
  return {
    docs,
    findById: (id) => ({ lean: async () => (docs[id] ? { ...docs[id] } : null) }),
    updateOne: async (filter, update, opts) => {
      const id = filter._id;
      if (!docs[id] && opts?.upsert) {
        docs[id] = { _id: id, seq: update.$setOnInsert?.seq ?? 0 };
      }
      return { acknowledged: true };
    },
    findOneAndUpdate: async (filter, update, opts) => {
      const id = filter._id;
      if (!docs[id]) {
        if (!opts?.upsert) return null;
        docs[id] = { _id: id, seq: 0 };
      }
      docs[id].seq += update.$inc?.seq ?? 0;
      return { ...docs[id] };
    },
  };
};
const makeFakeOrder = (count) => ({ estimatedDocumentCount: async () => count });

const run = async () => {
  console.log("── formatOrderId ───────────────────────────────");

  await test("zero-pads to 5 digits", () => {
    assert.equal(formatOrderId(1), "ORD00001");
    assert.equal(formatOrderId(42), "ORD00042");
    assert.equal(formatOrderId(12345), "ORD12345");
  });

  await test("does not truncate past 5 digits", () => {
    assert.equal(formatOrderId(123456), "ORD123456");
  });

  console.log("── nextOrderId ─────────────────────────────────");

  await test("first call on a fresh DB seeds from the order count and returns count+1", async () => {
    const Counter = makeFakeCounter();
    const id = await nextOrderId({ Counter, Order: makeFakeOrder(0) });
    assert.equal(id, "ORD00001");
    assert.equal(Counter.docs[ORDER_NUMBER_KEY].seq, 1);
  });

  await test("continues existing numbering — never resets to ORD00001", async () => {
    const Counter = makeFakeCounter();
    // 7 legacy orders already exist, no counter doc yet
    const id = await nextOrderId({ Counter, Order: makeFakeOrder(7) });
    assert.equal(id, "ORD00008");
  });

  await test("sequential calls hand out strictly increasing, unique numbers", async () => {
    const Counter = makeFakeCounter();
    const Order = makeFakeOrder(0);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await nextOrderId({ Counter, Order }));
    assert.deepEqual(ids, ["ORD00001", "ORD00002", "ORD00003", "ORD00004", "ORD00005"]);
    assert.equal(new Set(ids).size, 5);
  });

  await test("concurrent callers each get a distinct number (no ORD00001 twice)", async () => {
    // The fake's findOneAndUpdate mutates synchronously, mirroring the DB's
    // atomic $inc — this asserts the generator relies on that atomicity and
    // never does its own read-then-write.
    const Counter = makeFakeCounter({ [ORDER_NUMBER_KEY]: { _id: ORDER_NUMBER_KEY, seq: 0 } });
    const Order = makeFakeOrder(0);
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => nextOrderId({ Counter, Order })),
    );
    assert.equal(new Set(ids).size, 20, "expected 20 unique order ids");
    assert.ok(!ids.includes(undefined));
  });

  console.log("──────────────────────────────────────────────");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error("SOME TESTS FAILED"); process.exit(1); }
  console.log("ALL TESTS PASSED");
};

run();
