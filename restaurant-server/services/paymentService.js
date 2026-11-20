// services/paymentService.js
// ─────────────────────────────────────────────────────────────────────────────
// PhonePe Payment Gateway (PG) — hosted "PAY_PAGE" checkout, salt-key
// (X-VERIFY) flow.  https://developer.phonepe.com/v4/docs/step
//
// ── How this squares with "the backend is authoritative for payment" ────────
// A customer paying online is redirected to PhonePe's own hosted page. PhonePe
// then tells US the outcome two ways, and ONLY these two ever move an order to
// paymentStatus = PAID:
//   1. a checksum-verified server-to-server callback
//      (POST /api/payments/phonepe/callback)
//   2. our own checksum-signed status query to PhonePe
//      (GET /pg/v1/status/{merchantId}/{merchantTransactionId})
// The customer's browser merely landing back on the return URL is NOT proof of
// payment — same principle as the old UPI deep link. A verified gateway result
// is simply now an accepted proof alongside an explicit admin/waiter action.
//
// Credentials live in the backend .env (PHONEPE_*), NOT RestaurantProfile — the
// salt key is a secret, same category as JWT_SECRET / the Twilio keys. Leave
// PHONEPE_MERCHANT_ID / PHONEPE_SALT_KEY blank to disable the gateway; callers
// fall back to the UPI deep link / cash.
//
// Idempotency: applyPhonePeResult() is a single atomic conditional
// findOneAndUpdate (never check-then-save) — whichever of {callback, customer
// poll, admin re-check} lands first flips the order; the rest are safe no-ops.
// Same pattern as KOTJob (see config/getModels.js).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import axios from "axios";
import { resolvePhonePeEnv, PHONEPE_ENVS } from "../utils/phonePeEnv.js";

export const PHONEPE_HOSTS = Object.freeze({
  [PHONEPE_ENVS.SANDBOX]:    "https://api-preprod.phonepe.com/apis/pg-sandbox",
  [PHONEPE_ENVS.PRODUCTION]: "https://api.phonepe.com/apis/hermes",
});

// PHONEPE_ENV goes through utils/phonePeEnv.js ONLY. An unrecognised value (or
// a blank one in production) gives host = null and the gateway counts as NOT
// configured — it is never silently guessed to be the sandbox.
const cfg = () => {
  const resolved = resolvePhonePeEnv(process.env);
  return {
    merchantId: process.env.PHONEPE_MERCHANT_ID || "",
    saltKey:    process.env.PHONEPE_SALT_KEY || "",
    saltIndex:  process.env.PHONEPE_SALT_INDEX || "1",
    env:        resolved.env,
    host:       resolved.valid ? PHONEPE_HOSTS[resolved.env] : null,
  };
};

/** Which PhonePe host requests would go to right now (null = disabled). No secrets. */
export const phonePeTarget = () => { const c = cfg(); return { env: c.env, host: c.host }; };

export const isPhonePeConfigured = () => {
  const c = cfg();
  return Boolean(c.merchantId && c.saltKey && c.host);
};

const PENDING = "PENDING";
const SUCCESS = "SUCCESS";
const FAILED  = "FAILED";
// PhonePe reported success, but for a different amount than this attempt was
// created for (or the order's total changed after the attempt started). Never
// marks the order PAID; terminal for this attempt, so a duplicate callback or
// a later poll can't flip it. Needs a person to look at it (refund / re-bill).
export const AMOUNT_MISMATCH = "AMOUNT_MISMATCH";
// Attempt states no gateway result may change any more.
const FINAL_STATES = [SUCCESS, AMOUNT_MISMATCH];
/** True once no gateway result may change this attempt (SUCCESS / AMOUNT_MISMATCH). */
export const isFinalAttemptState = (state) => FINAL_STATES.includes(state);

/** Paise the order is owed right now, from the server-side total. */
export const expectedAmountPaise = (order) => Math.round(Number(order?.total) * 100);

/**
 * Pure: does a gateway-reported SUCCESS amount match what we expect?
 * Fails closed — a missing / non-numeric amount is a mismatch.
 * @returns {{ ok: boolean, reason: string, reported: number|null, expected: number }}
 */
export const checkPaidAmount = ({ order, reportedAmount }) => {
  const attempt = Number(order?.payment?.amount);
  const total = expectedAmountPaise(order);
  const reported = reportedAmount === null || reportedAmount === undefined || reportedAmount === ""
    ? null : Number(reportedAmount);
  if (reported === null || !Number.isFinite(reported)) {
    return { ok: false, reason: "AMOUNT_MISSING", reported: null, expected: attempt };
  }
  if (!Number.isFinite(attempt) || attempt <= 0) {
    return { ok: false, reason: "ATTEMPT_AMOUNT_UNKNOWN", reported, expected: attempt };
  }
  if (reported !== attempt) return { ok: false, reason: "AMOUNT_DIFFERS", reported, expected: attempt };
  // The attempt was for the right amount when it started, but the bill has
  // since changed (e.g. staff edited the order) — paying the old amount must
  // not settle the new bill.
  if (attempt !== total) return { ok: false, reason: "ORDER_TOTAL_CHANGED", reported, expected: total };
  return { ok: true, reason: "", reported, expected: attempt };
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// X-VERIFY for a request carrying a base64 body: sha256(base64 + path + salt)###index
const signRequest = (base64Body, path) => {
  const { saltKey, saltIndex } = cfg();
  return `${sha256(base64Body + path + saltKey)}###${saltIndex}`;
};

// X-VERIFY for a GET (status) call: sha256(path + salt)###index
const signPath = (path) => {
  const { saltKey, saltIndex } = cfg();
  return `${sha256(path + saltKey)}###${saltIndex}`;
};

// X-VERIFY that PhonePe stamps on its callback: sha256(base64Response + salt)###index
export const verifyCallbackSignature = (base64Response, headerValue) => {
  const { saltKey, saltIndex } = cfg();
  if (!saltKey) return false;
  const expected = `${sha256(String(base64Response ?? "") + saltKey)}###${saltIndex}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(headerValue ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// PhonePe response `code` → our internal payment.state
export const mapPhonePeCode = (code) => {
  if (code === "PAYMENT_SUCCESS") return SUCCESS;
  if (code === "PAYMENT_PENDING" || code === "PAYMENT_INITIATED") return PENDING;
  return FAILED; // PAYMENT_ERROR / PAYMENT_DECLINED / TIMED_OUT / INTERNAL_SERVER_ERROR / ...
};

// ── Initiate a payment for an order ─────────────────────────────────────────
// Amount is ALWAYS derived from order.total server-side — never from the client.
export const initiatePhonePePayment = async ({ order, redirectUrl, callbackUrl }) => {
  if (!isPhonePeConfigured()) {
    const e = new Error("PhonePe is not configured on the server");
    e.statusCode = 503; throw e;
  }
  if (order.paymentStatus === "PAID") {
    const e = new Error("This order is already paid");
    e.statusCode = 409; throw e;
  }

  const { merchantId, host } = cfg();
  if (!host) { const e = new Error("PhonePe environment is not configured correctly"); e.statusCode = 503; throw e; }
  // One transaction id per attempt (<=35 chars, [a-zA-Z0-9_-]).
  const merchantTransactionId = `T${String(order._id)}${Date.now().toString(36)}`.slice(0, 35);
  const amountPaise = expectedAmountPaise(order);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    const e = new Error("Order total is not payable"); e.statusCode = 400; throw e;
  }

  const payload = {
    merchantId,
    merchantTransactionId,
    merchantUserId: `U${String(order.user || order._id)}`.slice(0, 35),
    amount: amountPaise,
    redirectUrl,
    redirectMode: "REDIRECT",
    callbackUrl,
    ...(order.guestPhone
      ? { mobileNumber: String(order.guestPhone).replace(/\D/g, "").slice(-10) }
      : {}),
    paymentInstrument: { type: "PAY_PAGE" },
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const path = "/pg/v1/pay";

  let res;
  try {
    res = await axios.post(
      `${host}${path}`,
      { request: base64 },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": signRequest(base64, path),
          accept: "application/json",
        },
        timeout: 15000,
      },
    );
  } catch (err) {
    console.error("PhonePe /pay error:", err.response?.status, err.response?.data || err.message);
    const e = new Error(err.response?.data?.message || "PhonePe did not accept the payment request");
    e.statusCode = 502; throw e;
  }

  const url = res.data?.data?.instrumentResponse?.redirectInfo?.url;
  if (!res.data?.success || !url) {
    const e = new Error(res.data?.message || "PhonePe did not return a payment URL");
    e.statusCode = 502; throw e;
  }

  order.payment = {
    provider: "PHONEPE",
    merchantTransactionId,
    amount: amountPaise,
    state: PENDING,
    phonepeTransactionId: "",
    lastCheckedAt: new Date(),
    raw: { initiate: res.data?.code || "" },
  };
  await order.save();

  return { redirectUrl: url, merchantTransactionId };
};

// ── Ask PhonePe for the current status of an order's latest attempt ─────────
export const fetchPhonePeStatus = async ({ order }) => {
  if (!isPhonePeConfigured()) {
    const e = new Error("PhonePe is not configured"); e.statusCode = 503; throw e;
  }
  const mtid = order.payment?.merchantTransactionId;
  if (!mtid) {
    const e = new Error("No PhonePe payment was started for this order"); e.statusCode = 400; throw e;
  }

  const { merchantId, host } = cfg();
  if (!host) { const e = new Error("PhonePe environment is not configured correctly"); e.statusCode = 503; throw e; }
  const path = `/pg/v1/status/${merchantId}/${mtid}`;

  let res;
  try {
    res = await axios.get(`${host}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": signPath(path),
        "X-MERCHANT-ID": merchantId,
        accept: "application/json",
      },
      timeout: 15000,
    });
  } catch (err) {
    console.error("PhonePe /status error:", err.response?.status, err.response?.data || err.message);
    const e = new Error("Could not reach PhonePe to check payment status");
    e.statusCode = 502; throw e;
  }

  return {
    state: mapPhonePeCode(res.data?.code),
    code: res.data?.code || "",
    phonepeTransactionId: res.data?.data?.transactionId || "",
    amount: res.data?.data?.amount ?? null,
  };
};

// ── Decode a PhonePe callback body ({ response: "<base64>" }) ───────────────
export const decodeCallback = (body) => {
  const b64 = body?.response;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return {
      merchantTransactionId:
        json?.data?.merchantTransactionId || json?.data?.merchantOrderId || "",
      state: mapPhonePeCode(json?.code),
      code: json?.code || "",
      phonepeTransactionId: json?.data?.transactionId || "",
      amount: json?.data?.amount ?? null,
    };
  } catch {
    return null;
  }
};

// ── Apply a gateway result to an order — atomic, idempotent ─────────────────
// `result` is { state, code, phonepeTransactionId, amount } from either
// decodeCallback or fetchPhonePeStatus. Returns { order, changed, mismatch }.
//
// Finalised attempts (SUCCESS, AMOUNT_MISMATCH) are never changed again — a
// duplicate / late / contradictory callback or poll is a no-op. A FAILED
// attempt may still become SUCCESS on a later VERIFIED result (the money was
// in fact taken), but never the other way round.
//
// SUCCESS is accepted only if the reported amount equals the attempt's amount
// AND that still equals the order's current total (checkPaidAmount). Both are
// re-asserted in the update filter, so an order edited between our read and
// our write can't be marked PAID for the old amount.
export const applyPhonePeResult = async ({ models, orderId, merchantTransactionId, result }) => {
  const { Order } = models;
  const match = { _id: orderId, "payment.merchantTransactionId": merchantTransactionId };
  const now = new Date();

  if (result.state === SUCCESS) {
    const current = await Order.findById(orderId);
    if (!current || current.payment?.merchantTransactionId !== merchantTransactionId) {
      return { order: current, changed: false, mismatch: false };
    }
    if (FINAL_STATES.includes(current.payment?.state)) {
      return { order: current, changed: false, mismatch: current.payment.state === AMOUNT_MISMATCH };
    }

    const check = checkPaidAmount({ order: current, reportedAmount: result.amount });
    if (!check.ok) {
      const flagged = await Order.findOneAndUpdate(
        { ...match, "payment.state": { $nin: FINAL_STATES } },
        {
          $set: {
            "payment.state": AMOUNT_MISMATCH,
            "payment.lastCheckedAt": now,
            "payment.raw": {
              code: result.code || "PAYMENT_SUCCESS",
              mismatch: check.reason,
              reportedAmount: check.reported,
              expectedAmount: check.expected,
            },
          },
        },
        { returnDocument: "after" },
      );
      // No PII — order ref + amounts only. Money may have been taken: a person
      // must refund or re-bill (there is no automatic refund yet).
      console.error(
        `⚠️ PhonePe amount mismatch on order ${current.orderId || current._id} (${check.reason}): ` +
        `reported ${check.reported ?? "none"} paise, expected ${check.expected} paise — NOT marked paid; needs review`,
      );
      return { order: flagged || (await Order.findById(orderId)), changed: false, mismatch: true };
    }

    const updated = await Order.findOneAndUpdate(
      {
        ...match,
        "payment.state": { $nin: FINAL_STATES },
        "payment.amount": check.reported,
        total: current.total,
      },
      {
        $set: {
          paymentStatus: "PAID",
          paymentMethod: "Online",
          // The customer paid the gateway — no employee collected it
          // (staffReportService lists it as "Online gateway").
          paidBy: null,
          paidAt: now,
          "payment.state": SUCCESS,
          "payment.phonepeTransactionId": result.phonepeTransactionId || "",
          "payment.lastCheckedAt": now,
          "payment.raw": { code: result.code || "PAYMENT_SUCCESS" },
        },
      },
      { returnDocument: "after" },
    );
    if (updated) return { order: updated, changed: true, mismatch: false };
    // Lost a race: either another path already finalised it (fine), or the
    // order total changed under us — re-run once against the fresh order so
    // the latter is recorded as a mismatch instead of silently ignored.
    const fresh = await Order.findById(orderId);
    if (fresh && !FINAL_STATES.includes(fresh.payment?.state)) {
      return applyPhonePeResult({ models, orderId, merchantTransactionId, result });
    }
    return { order: fresh, changed: false, mismatch: fresh?.payment?.state === AMOUNT_MISMATCH };
  }

  if (result.state === FAILED) {
    // Deliberately does NOT touch paymentStatus — the order stays
    // PENDING_VERIFICATION so the customer can retry or pay cash. We only
    // record that this attempt failed.
    const updated = await Order.findOneAndUpdate(
      { ...match, "payment.state": { $nin: [...FINAL_STATES, FAILED] } },
      {
        $set: {
          "payment.state": FAILED,
          "payment.lastCheckedAt": now,
          "payment.raw": { code: result.code || "PAYMENT_ERROR" },
        },
      },
      { returnDocument: "after" },
    );
    return { order: updated || (await Order.findById(orderId)), changed: Boolean(updated), mismatch: false };
  }

  // PENDING — just stamp the check time.
  const updated = await Order.findOneAndUpdate(
    { ...match, "payment.state": PENDING },
    { $set: { "payment.lastCheckedAt": now } },
    { returnDocument: "after" },
  );
  return { order: updated || (await Order.findById(orderId)), changed: false, mismatch: false };
};
