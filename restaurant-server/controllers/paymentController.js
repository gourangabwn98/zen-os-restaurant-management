// controllers/paymentController.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP layer over services/paymentService.js. All the checksum / gateway /
// idempotency logic lives there.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isPhonePeConfigured, initiatePhonePePayment, fetchPhonePeStatus,
  applyPhonePeResult, decodeCallback, verifyCallbackSignature,
} from "../services/paymentService.js";
import { assertCanViewOrder } from "../services/orderService.js";
import { emitPaymentStatusChanged } from "../sockets/socket.js";

const clientBase = () => (process.env.CLIENT_URL || "").replace(/\/+$/, "");

// Public base URL of THIS backend — used to build the PhonePe callback URL.
// Prefer an explicit env var; fall back to the incoming request's own host
// (correct on Render/most PaaS, where the proxy sets Host + x-forwarded-proto).
const apiBase = (req) => {
  const env = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  if (env) return env;
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
};

// ── POST /api/payments/phonepe/initiate   { orderId } ──────────────────────
// Guest (x-guest-order-token) or logged-in customer. Returns { redirectUrl }.
export const initiatePhonePe = async (req, res) => {
  try {
    if (!req.models) return res.status(503).json({ message: "Restaurant database unavailable" });
    if (!isPhonePeConfigured()) {
      return res.status(503).json({ message: "Online payment is not available right now" });
    }

    const { Order } = req.models;
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ message: "orderId is required" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    assertCanViewOrder(req, order);

    if (order.status === "CANCELLED") return res.status(409).json({ message: "This order was cancelled" });
    if (order.paymentStatus === "PAID") return res.status(409).json({ message: "This order is already paid" });

    const redirectUrl = `${clientBase()}/order/${order._id}?payment=phonepe`;
    const callbackUrl = `${apiBase(req)}/api/payments/phonepe/callback`;

    const { redirectUrl: payUrl } = await initiatePhonePePayment({ order, redirectUrl, callbackUrl });
    res.json({ redirectUrl: payUrl });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/payments/phonepe/status/:orderId ─────────────────────────────
// Called by the customer app after it is redirected back from PhonePe. Does a
// live, checksum-signed status query and (atomically) applies the result.
export const phonePeOrderStatus = async (req, res) => {
  try {
    const { Order } = req.models;
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    assertCanViewOrder(req, order);

    let current = order;
    if (
      isPhonePeConfigured() &&
      order.payment?.merchantTransactionId &&
      order.payment?.state !== "SUCCESS"
    ) {
      try {
        const result = await fetchPhonePeStatus({ order });
        const { order: updated, changed } = await applyPhonePeResult({
          models: req.models,
          orderId: order._id,
          merchantTransactionId: order.payment.merchantTransactionId,
          result,
        });
        current = updated || order;
        if (changed) emitPaymentStatusChanged(req.tenantKey, current);
      } catch (e) {
        // Network / gateway hiccup — fall through with the un-refreshed order.
        console.error("phonePeOrderStatus refresh failed:", e.message);
      }
    }

    res.json({
      paymentStatus: current.paymentStatus,
      paymentMethod: current.paymentMethod,
      paymentState: current.payment?.state || "NONE",
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/payments/phonepe/callback   (PhonePe server-to-server) ───────
// No JWT — authenticated by the X-VERIFY checksum on the body.
export const phonePeCallback = async (req, res) => {
  try {
    const signature = req.get("X-VERIFY");
    const b64 = req.body?.response;
    if (!b64 || !verifyCallbackSignature(b64, signature)) {
      return res.status(400).json({ message: "Invalid callback signature" });
    }

    const decoded = decodeCallback(req.body);
    if (!decoded?.merchantTransactionId) {
      return res.status(400).json({ message: "Malformed callback" });
    }

    const { Order } = req.models;
    const order = await Order.findOne({
      "payment.merchantTransactionId": decoded.merchantTransactionId,
    });
    // Unknown txn — ack anyway so PhonePe doesn't keep retrying.
    if (!order) return res.status(200).json({ ok: true });

    const { order: updated, changed } = await applyPhonePeResult({
      models: req.models,
      orderId: order._id,
      merchantTransactionId: decoded.merchantTransactionId,
      result: decoded,
    });
    if (changed) emitPaymentStatusChanged(req.tenantKey, updated);

    res.status(200).json({ ok: true });
  } catch (err) {
    // Always 200 so PhonePe doesn't hammer retries against our own bug; the
    // customer poll / an admin re-check will still reconcile the order.
    console.error("phonePeCallback error:", err);
    res.status(200).json({ ok: false });
  }
};
