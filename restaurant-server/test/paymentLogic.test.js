// test/paymentLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Plain-Node assertion tests (no framework) for the PhonePe payment logic that
// doesn't need a live MongoDB: checksum verification, code mapping, callback
// decoding, and the atomic/idempotent result-apply contract. Run with:
//   node test/paymentLogic.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.PHONEPE_MERCHANT_ID = "TESTMERCHANT";
process.env.PHONEPE_SALT_KEY = "test-salt-key-123";
process.env.PHONEPE_SALT_INDEX = "1";

const {
  isPhonePeConfigured, verifyCallbackSignature, mapPhonePeCode,
  decodeCallback, applyPhonePeResult,
} = await import("../services/paymentService.js");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const run = async () => {
  console.log("── config ─────────────────────────────────────");
  await test("isPhonePeConfigured true when merchant id + salt present", () => {
    assert.equal(isPhonePeConfigured(), true);
  });

  console.log("── verifyCallbackSignature ────────────────────");
  const responseB64 = Buffer.from(JSON.stringify({ code: "PAYMENT_SUCCESS" })).toString("base64");
  const goodSig = `${sha256(responseB64 + "test-salt-key-123")}###1`;

  await test("accepts a correctly signed callback", () => {
    assert.equal(verifyCallbackSignature(responseB64, goodSig), true);
  });
  await test("rejects a tampered signature", () => {
    assert.equal(verifyCallbackSignature(responseB64, goodSig.replace(/^./, "0")), false);
  });
  await test("rejects a tampered body", () => {
    assert.equal(verifyCallbackSignature(responseB64 + "x", goodSig), false);
  });
  await test("rejects a missing signature", () => {
    assert.equal(verifyCallbackSignature(responseB64, undefined), false);
  });

  console.log("── mapPhonePeCode ─────────────────────────────");
  await test("PAYMENT_SUCCESS → SUCCESS", () => assert.equal(mapPhonePeCode("PAYMENT_SUCCESS"), "SUCCESS"));
  await test("PAYMENT_PENDING → PENDING", () => assert.equal(mapPhonePeCode("PAYMENT_PENDING"), "PENDING"));
  await test("PAYMENT_ERROR → FAILED", () => assert.equal(mapPhonePeCode("PAYMENT_ERROR"), "FAILED"));
  await test("unknown code → FAILED (never SUCCESS)", () => assert.equal(mapPhonePeCode("WAT"), "FAILED"));

  console.log("── decodeCallback ─────────────────────────────");
  await test("decodes a well-formed callback body", () => {
    const body = { response: Buffer.from(JSON.stringify({
      code: "PAYMENT_SUCCESS",
      data: { merchantTransactionId: "T123", transactionId: "PPX999", amount: 12300 },
    })).toString("base64") };
    const d = decodeCallback(body);
    assert.equal(d.merchantTransactionId, "T123");
    assert.equal(d.state, "SUCCESS");
    assert.equal(d.phonepeTransactionId, "PPX999");
  });
  await test("returns null for garbage", () => {
    assert.equal(decodeCallback({ response: "!!!not-base64-json" }), null);
    assert.equal(decodeCallback({}), null);
  });

  console.log("── applyPhonePeResult (atomic / idempotent) ───");

  // Minimal fake of the Mongoose Order model: one in-memory doc, findOneAndUpdate
  // honours a `payment.state` $ne / $nin guard just like Mongo would.
  const makeModels = (doc) => ({
    Order: {
      _doc: doc,
      async findById() { return this._doc; },
      async findOneAndUpdate(filter, update) {
        const g = filter["payment.state"];
        const cur = this._doc.payment.state;
        if (g?.$ne !== undefined && cur === g.$ne) return null;
        if (g?.$nin && g.$nin.includes(cur)) return null;
        if (g && g.$ne === undefined && g.$nin === undefined && cur !== g) return null;
        const set = update.$set || {};
        for (const [k, v] of Object.entries(set)) {
          if (k.startsWith("payment.")) this._doc.payment[k.slice(8)] = v;
          else this._doc[k] = v;
        }
        return this._doc;
      },
    },
  });

  await test("SUCCESS marks the order PAID + Online, and reports changed", async () => {
    const models = makeModels({
      _id: "o1", paymentStatus: "PENDING_VERIFICATION", paymentMethod: "Cash",
      payment: { merchantTransactionId: "T1", state: "PENDING" },
    });
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "o1", merchantTransactionId: "T1",
      result: { state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "PP1" },
    });
    assert.equal(changed, true);
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.paymentMethod, "Online");
    assert.equal(order.payment.state, "SUCCESS");
  });

  await test("a second SUCCESS is a no-op (changed=false), order stays PAID", async () => {
    const models = makeModels({
      _id: "o2", paymentStatus: "PAID", paymentMethod: "Online",
      payment: { merchantTransactionId: "T2", state: "SUCCESS" },
    });
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "o2", merchantTransactionId: "T2",
      result: { state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "PP2" },
    });
    assert.equal(changed, false);
    assert.equal(order.paymentStatus, "PAID");
  });

  await test("FAILED does NOT touch paymentStatus (cash/retry still possible)", async () => {
    const models = makeModels({
      _id: "o3", paymentStatus: "PENDING_VERIFICATION", paymentMethod: "Cash",
      payment: { merchantTransactionId: "T3", state: "PENDING" },
    });
    const { order } = await applyPhonePeResult({
      models, orderId: "o3", merchantTransactionId: "T3",
      result: { state: "FAILED", code: "PAYMENT_ERROR" },
    });
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.payment.state, "FAILED");
  });

  await test("a FAILED callback after SUCCESS cannot un-pay the order", async () => {
    const models = makeModels({
      _id: "o4", paymentStatus: "PAID", paymentMethod: "Online",
      payment: { merchantTransactionId: "T4", state: "SUCCESS" },
    });
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "o4", merchantTransactionId: "T4",
      result: { state: "FAILED", code: "PAYMENT_ERROR" },
    });
    assert.equal(changed, false);
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.payment.state, "SUCCESS");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
};

run();
