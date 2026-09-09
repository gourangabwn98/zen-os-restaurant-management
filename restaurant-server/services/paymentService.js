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

const HOSTS = {
  SANDBOX:    "https://api-preprod.phonepe.com/apis/pg-sandbox",
  PRODUCTION: "https://api.phonepe.com/apis/hermes",
};

const cfg = () => ({
  merchantId: process.env.PHONEPE_MERCHANT_ID || "",
  saltKey:    process.env.PHONEPE_SALT_KEY || "",
  saltIndex:  process.env.PHONEPE_SALT_INDEX || "1",
  host:       HOSTS[(process.env.PHONEPE_ENV || "SANDBOX").toUpperCase()] || HOSTS.SANDBOX,
});

export const isPhonePeConfigured = () => {
  const c = cfg();
  return Boolean(c.merchantId && c.saltKey);
};

const PENDING = "PENDING";
const SUCCESS = "SUCCESS";
const FAILED  = "FAILED";

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
  // One transaction id per attempt (<=35 chars, [a-zA-Z0-9_-]).
  const merchantTransactionId = `T${String(order._id)}${Date.now().toString(36)}`.slice(0, 35);
  const amountPaise = Math.round(Number(order.total) * 100);
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
// `result` is { state, code, phonepeTransactionId } from either decodeCallback
// or fetchPhonePeStatus. Returns { order, changed }.
export const applyPhonePeResult = async ({ models, orderId, merchantTransactionId, result }) => {
  const { Order } = models;
  const match = { _id: orderId, "payment.merchantTransactionId": merchantTransactionId };
  const now = new Date();

  if (result.state === SUCCESS) {
    const updated = await Order.findOneAndUpdate(
      { ...match, "payment.state": { $ne: SUCCESS } },
      {
        $set: {
          paymentStatus: "PAID",
          paymentMethod: "Online",
          "payment.state": SUCCESS,
          "payment.phonepeTransactionId": result.phonepeTransactionId || "",
          "payment.lastCheckedAt": now,
          "payment.raw": { code: result.code || "PAYMENT_SUCCESS" },
        },
      },
      { new: true },
    );
    return { order: updated || (await Order.findById(orderId)), changed: Boolean(updated) };
  }

  if (result.state === FAILED) {
    // Deliberately does NOT touch paymentStatus — the order stays
    // PENDING_VERIFICATION so the customer can retry or pay cash. We only
    // record that this attempt failed.
    const updated = await Order.findOneAndUpdate(
      { ...match, "payment.state": { $nin: [SUCCESS, FAILED] } },
      {
        $set: {
          "payment.state": FAILED,
          "payment.lastCheckedAt": now,
          "payment.raw": { code: result.code || "PAYMENT_ERROR" },
        },
      },
      { new: true },
    );
    return { order: updated || (await Order.findById(orderId)), changed: Boolean(updated) };
  }

  // PENDING — just stamp the check time.
  const updated = await Order.findOneAndUpdate(
    { ...match, "payment.state": PENDING },
    { $set: { "payment.lastCheckedAt": now } },
    { new: true },
  );
  return { order: updated || (await Order.findById(orderId)), changed: false };
};
