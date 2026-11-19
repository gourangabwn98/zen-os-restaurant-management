// services/deliveryRealtime.js
// ─────────────────────────────────────────────────────────────────────────────
// Publishes the `effects` that services/deliveryService.js returns, AFTER the
// database write committed. Rooms (utils/tenantKey.js):
//   partner  → tenant:{k}:user:{riderId}    that rider's own sockets only
//   admin    → tenant:{k}:delivery-admin    admin + manager (full detail)
//   track    → tenant:{k}:track:{jobId}     the customer holding that job's link
//              + tenant:{k}:order:{orderId} the customer's own order page
//   offer    → partner room + FCM data push (the app may be in the background)
// Never throws: a failed emit/push must not undo or fail a committed change.
// Riders never receive another customer's details; tracking rooms never
// receive an OTP or a phone number (deliveryService builds those payloads).
// ─────────────────────────────────────────────────────────────────────────────

import {
  emitToDeliveryPartner, emitDeliveryAdmin, emitDeliveryTracking, emitOrderStatusChanged,
} from "../sockets/socket.js";
import { dropDeadPushTokens } from "./deliveryService.js";

let messagingPromise = null;
const firebaseConfigured = () =>
  !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);

/** firebase-admin is loaded lazily, and only when it is configured. */
const getMessaging = () => {
  if (!firebaseConfigured()) return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = import("../utils/firebaseAdmin.js")
      .then((m) => m.default.messaging())
      .catch((err) => { console.error("delivery push: Firebase unavailable:", err.message); return null; });
  }
  return messagingPromise;
};

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument",
]);

/**
 * High-priority DATA message (no `notification` block): the app's own
 * handler shows a full-screen "new request" card with Accept/Reject. TTL =
 * the offer's remaining time, so a phone that comes back online later never
 * rings for a request that has already gone.
 */
export const sendOfferPush = async ({ models, tokens, offer }) => {
  if (!tokens?.length) return { sent: 0 };
  const messaging = await getMessaging();
  if (!messaging) return { sent: 0, skipped: "FIREBASE_NOT_CONFIGURED" };
  const ttlMs = Math.max(1000, new Date(offer.expiresAt).getTime() - Date.now());
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: {
        type: "delivery_offer",
        jobId: String(offer.jobId),
        orderNo: String(offer.orderNo || ""),
        expiresAt: new Date(offer.expiresAt).toISOString(),
        distanceMeters: offer.distanceMeters == null ? "" : String(offer.distanceMeters),
        pickupName: String(offer.pickup?.name || ""),
      },
      android: { priority: "high", ttl: ttlMs, collapseKey: `offer-${offer.jobId}` },
    });
    const dead = [];
    res.responses.forEach((r, i) => { if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) dead.push(tokens[i]); });
    if (dead.length && models) await dropDeadPushTokens(models, dead);
    return { sent: res.successCount, failed: res.failureCount };
  } catch (err) {
    console.error("delivery push failed:", err.message);
    return { sent: 0, error: err.message };
  }
};

/** Short data push for "taken by someone else" / "expired", so a backgrounded app clears its card. */
const sendClosePush = async ({ tokens, jobId, reason }) => {
  if (!tokens?.length) return;
  const messaging = await getMessaging();
  if (!messaging) return;
  try {
    await messaging.sendEachForMulticast({
      tokens, data: { type: "delivery_offer_closed", jobId: String(jobId), reason },
      android: { priority: "high", ttl: 60 * 1000, collapseKey: `offer-${jobId}` },
    });
  } catch (err) { console.error("delivery close push failed:", err.message); }
};

const CLOSE_EVENTS = { "delivery:already_assigned": "TAKEN", "delivery:request_expired": "EXPIRED" };

export const publishDeliveryEffects = (tenantKey, effects = [], { models } = {}) => {
  for (const fx of effects) {
    try {
      switch (fx.type) {
        case "offer":
          emitToDeliveryPartner(tenantKey, fx.partnerId, "delivery:request_received", { offer: fx.payload });
          sendOfferPush({ models, tokens: fx.tokens, offer: fx.payload }).catch(() => {});
          break;
        case "partner":
          emitToDeliveryPartner(tenantKey, fx.partnerId, fx.event, fx.payload);
          if (CLOSE_EVENTS[fx.event] && models) {
            models.DeliveryPartnerState.findOne({ partner: fx.partnerId }).select("fcmTokens").lean()
              .then((st) => sendClosePush({ tokens: st?.fcmTokens, jobId: fx.payload?.jobId, reason: CLOSE_EVENTS[fx.event] }))
              .catch(() => {});
          }
          break;
        case "admin":
          emitDeliveryAdmin(tenantKey, fx.event, fx.payload);
          break;
        case "track":
          emitDeliveryTracking(tenantKey, fx.jobId, fx.orderId, fx.event, fx.payload);
          break;
        case "order_status":
          emitOrderStatusChanged(tenantKey, fx.order, fx.previousStatus);
          break;
        default:
          console.warn("delivery: unknown effect", fx.type);
      }
    } catch (err) {
      console.error(`delivery publish failed [${fx.type}]:`, err.message);
    }
  }
};

/** For controllers: sync the delivery with an order that just changed, then publish. Never throws, never blocks the response. */
export const kickDeliveryForOrder = (req, order) => {
  if (!order || order.orderType !== "ONLINE") return;
  import("./deliveryService.js")
    .then(({ syncDeliveryForOrder }) => syncDeliveryForOrder({ models: req.models, db: req.db, order }))
    .then((r) => publishDeliveryEffects(req.tenantKey, r?.effects, { models: req.models }))
    .catch((err) => console.error("delivery kick failed:", err.message));
};
