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
  decodeCallback, applyPhonePeResult, checkPaidAmount, isFinalAttemptState, AMOUNT_MISMATCH,
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

  // Minimal fake of the Mongoose Order model: one in-memory doc. findOneAndUpdate
  // honours a `payment.state` $ne / $nin guard AND plain equality on every other
  // filter key (_id, payment.merchantTransactionId, payment.amount, total) —
  // just like Mongo would. `writes` counts successful updates.
  const getPath = (o, k) => k.split(".").reduce((v, part) => (v == null ? v : v[part]), o);
  const makeModels = (doc) => ({
    Order: {
      _doc: doc,
      writes: 0,
      async findById() { return this._doc; },
      async findOneAndUpdate(filter, update) {
        for (const [k, g] of Object.entries(filter)) {
          const cur = getPath(this._doc, k);
          if (g && typeof g === "object") {
            if (g.$ne !== undefined && cur === g.$ne) return null;
            if (g.$nin && g.$nin.includes(cur)) return null;
          } else if (String(cur) !== String(g)) return null;
        }
        this.writes++;
        const set = update.$set || {};
        for (const [k, v] of Object.entries(set)) {
          if (k.startsWith("payment.")) this._doc.payment[k.slice(8)] = v;
          else this._doc[k] = v;
        }
        return this._doc;
      },
    },
  });
  // Rs 123.45 order with a PhonePe attempt created for exactly that amount.
  const pendingOrder = (id, over = {}) => ({
    _id: id, total: 123.45, paymentStatus: "PENDING_VERIFICATION", paymentMethod: "Cash",
    payment: { merchantTransactionId: `T${id}`, state: "PENDING", amount: 12345 },
    ...over,
  });
  const success = (extra = {}) => ({ state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "PP", amount: 12345, ...extra });

  await test("SUCCESS marks the order PAID + Online, and reports changed", async () => {
    const models = makeModels({
      _id: "o1", total: 50, paymentStatus: "PENDING_VERIFICATION", paymentMethod: "Cash",
      payment: { merchantTransactionId: "T1", state: "PENDING", amount: 5000 },
    });
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "o1", merchantTransactionId: "T1",
      result: { state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "PP1", amount: 5000 },
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
      result: { state: "SUCCESS", code: "PAYMENT_SUCCESS", phonepeTransactionId: "PP2", amount: 5000 },
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

  console.log("── amount verification ────────────────────────");

  await test("checkPaidAmount: exact match is ok (float total → paise)", () => {
    assert.equal(checkPaidAmount({ order: pendingOrder("a0"), reportedAmount: 12345 }).ok, true);
  });
  await test("checkPaidAmount: missing / non-numeric amount fails closed", () => {
    assert.equal(checkPaidAmount({ order: pendingOrder("a1"), reportedAmount: undefined }).reason, "AMOUNT_MISSING");
    assert.equal(checkPaidAmount({ order: pendingOrder("a1"), reportedAmount: "abc" }).reason, "AMOUNT_MISSING");
  });

  for (const [label, amount, reason] of [
    ["less than expected", 100, "AMOUNT_DIFFERS"],
    ["more than expected", 12346, "AMOUNT_DIFFERS"],
    ["missing", undefined, "AMOUNT_MISSING"],
  ]) {
    await test(`SUCCESS with amount ${label} is NOT marked PAID → AMOUNT_MISMATCH`, async () => {
      const models = makeModels(pendingOrder("m1"));
      const { order, changed, mismatch } = await applyPhonePeResult({
        models, orderId: "m1", merchantTransactionId: "Tm1", result: success({ amount }),
      });
      assert.equal(changed, false);
      assert.equal(mismatch, true);
      assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
      assert.equal(order.paymentMethod, "Cash");
      assert.equal(order.payment.state, AMOUNT_MISMATCH);
      assert.equal(order.payment.raw.mismatch, reason);
    });
  }

  await test("order total changed after the attempt started → not PAID (ORDER_TOTAL_CHANGED)", async () => {
    const models = makeModels(pendingOrder("m2", { total: 200 }));
    const { order, mismatch } = await applyPhonePeResult({
      models, orderId: "m2", merchantTransactionId: "Tm2", result: success(),
    });
    assert.equal(mismatch, true);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.payment.raw.mismatch, "ORDER_TOTAL_CHANGED");
  });

  await test("total edited between read and PAID write → write refused, recorded as mismatch", async () => {
    const models = makeModels(pendingOrder("m3"));
    const realUpdate = models.Order.findOneAndUpdate.bind(models.Order);
    let raced = false;
    models.Order.findOneAndUpdate = async function (f, u) {
      // Staff edits the bill just before the PAID write lands.
      if (!raced && u.$set?.paymentStatus === "PAID") { raced = true; this._doc.total = 150; }
      return realUpdate(f, u);
    };
    const { order, changed, mismatch } = await applyPhonePeResult({
      models, orderId: "m3", merchantTransactionId: "Tm3", result: success(),
    });
    assert.equal(raced, true);
    assert.equal(changed, false);
    assert.equal(mismatch, true);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
    assert.equal(order.payment.raw.mismatch, "ORDER_TOTAL_CHANGED");
  });

  console.log("── finalised attempts can't be changed ────────");

  await test("duplicate SUCCESS after PAID changes nothing (txn id / paidAt kept)", async () => {
    const paidAt = new Date("2026-01-01T10:00:00Z");
    const models = makeModels(pendingOrder("f1", {
      paymentStatus: "PAID", paymentMethod: "Online", paidAt,
      payment: { merchantTransactionId: "Tf1", state: "SUCCESS", amount: 12345, phonepeTransactionId: "ORIG" },
    }));
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "f1", merchantTransactionId: "Tf1", result: success({ phonepeTransactionId: "OTHER" }),
    });
    assert.equal(changed, false);
    assert.equal(models.Order.writes, 0);
    assert.equal(order.payment.phonepeTransactionId, "ORIG");
    assert.equal(order.paidAt, paidAt);
  });

  await test("a correct-amount SUCCESS after AMOUNT_MISMATCH cannot flip it to PAID", async () => {
    const models = makeModels(pendingOrder("f2", {
      payment: { merchantTransactionId: "Tf2", state: AMOUNT_MISMATCH, amount: 12345 },
    }));
    const { order, changed, mismatch } = await applyPhonePeResult({
      models, orderId: "f2", merchantTransactionId: "Tf2", result: success(),
    });
    assert.equal(changed, false);
    assert.equal(mismatch, true);
    assert.equal(models.Order.writes, 0);
    assert.equal(order.paymentStatus, "PENDING_VERIFICATION");
  });

  await test("FAILED / PENDING after AMOUNT_MISMATCH change nothing", async () => {
    const models = makeModels(pendingOrder("f3", {
      payment: { merchantTransactionId: "Tf3", state: AMOUNT_MISMATCH, amount: 12345 },
    }));
    await applyPhonePeResult({ models, orderId: "f3", merchantTransactionId: "Tf3", result: { state: "FAILED", code: "PAYMENT_ERROR" } });
    await applyPhonePeResult({ models, orderId: "f3", merchantTransactionId: "Tf3", result: { state: "PENDING", code: "PAYMENT_PENDING" } });
    assert.equal(models.Order.writes, 0);
    assert.equal(models.Order._doc.payment.state, AMOUNT_MISMATCH);
  });

  await test("PENDING after SUCCESS changes nothing", async () => {
    const models = makeModels(pendingOrder("f4", {
      paymentStatus: "PAID", payment: { merchantTransactionId: "Tf4", state: "SUCCESS", amount: 12345 },
    }));
    await applyPhonePeResult({ models, orderId: "f4", merchantTransactionId: "Tf4", result: { state: "PENDING", code: "PAYMENT_PENDING" } });
    assert.equal(models.Order.writes, 0);
    assert.equal(models.Order._doc.paymentStatus, "PAID");
  });

  await test("result for a different (older) attempt's txn id changes nothing", async () => {
    const models = makeModels(pendingOrder("f5"));
    const { changed } = await applyPhonePeResult({
      models, orderId: "f5", merchantTransactionId: "T-OLD-ATTEMPT", result: success(),
    });
    assert.equal(changed, false);
    assert.equal(models.Order.writes, 0);
    assert.equal(models.Order._doc.paymentStatus, "PENDING_VERIFICATION");
  });

  await test("a verified late SUCCESS after a FAILED attempt still records the payment", async () => {
    const models = makeModels(pendingOrder("f6", {
      payment: { merchantTransactionId: "Tf6", state: "FAILED", amount: 12345 },
    }));
    const { order, changed } = await applyPhonePeResult({
      models, orderId: "f6", merchantTransactionId: "Tf6", result: success(),
    });
    assert.equal(changed, true);
    assert.equal(order.paymentStatus, "PAID");
  });

  await test("isFinalAttemptState: SUCCESS and AMOUNT_MISMATCH only", () => {
    assert.equal(isFinalAttemptState("SUCCESS"), true);
    assert.equal(isFinalAttemptState(AMOUNT_MISMATCH), true);
    for (const st of ["CREATED", "PENDING", "FAILED", undefined]) assert.equal(isFinalAttemptState(st), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
};

run();
