// services/notificationService.js
// ─────────────────────────────────────────────────────────────────────────────
// Opt-in customer push notifications (offers broadcast), built on Firebase
// Cloud Messaging. Broadcasting uses a single FCM topic rather than
// collecting every device token and multicasting to each one individually —
// subscribing/unsubscribing a token to the topic happens once, at opt-in/
// opt-out time (see subscribeToken/unsubscribeToken), so sendOfferBroadcast
// is always exactly one admin.messaging().send() call regardless of how many
// customers are currently opted in. No batching, no per-token pruning.
// ─────────────────────────────────────────────────────────────────────────────
import admin from "../utils/firebaseAdmin.js";

export const OFFERS_TOPIC = "offers";

/** Adds a device token to the customer's account and subscribes it to the
 * offers topic. $addToSet keeps this idempotent — re-enabling on the same
 * device (or a second tab) never duplicates the token. */
export const subscribeToken = async ({ models, userId, token }) => {
  if (!token || typeof token !== "string") {
    const err = new Error("A valid push token is required");
    err.statusCode = 400;
    throw err;
  }
  const { User } = models;
  await User.findByIdAndUpdate(userId, { $addToSet: { pushTokens: token } });
  await admin.messaging().subscribeToTopic([token], OFFERS_TOPIC);
};

/** Removes a device token and unsubscribes it from the offers topic. Safe
 * to call even if the token was never subscribed (e.g. permission was
 * revoked in the browser before the customer toggled it off in-app). */
export const unsubscribeToken = async ({ models, userId, token }) => {
  if (!token || typeof token !== "string") {
    const err = new Error("A valid push token is required");
    err.statusCode = 400;
    throw err;
  }
  const { User } = models;
  await User.findByIdAndUpdate(userId, { $pull: { pushTokens: token } });
  await admin.messaging().unsubscribeFromTopic([token], OFFERS_TOPIC);
};

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;
const PUSH_TTL_SECONDS = 24 * 60 * 60; // an offer a day late is no longer useful
export const CUSTOMER_HISTORY_LIMIT = 50;

/** "  diwali20 " → "DIWALI20"; "" → "" (no coupon). Throws 400 if malformed. */
export const normalizeCouponCode = (raw) => {
  const code = String(raw ?? "").trim().toUpperCase();
  if (!code) return "";
  if (!COUPON_RE.test(code)) throw httpError("Coupon code must be 3–20 characters: letters, numbers, - or _");
  return code;
};

const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

/**
 * Admin-triggered broadcast to every opted-in customer.
 *
 * Sent as a DATA-ONLY web-push message: the customer app's service worker
 * (public/firebase-messaging-sw.js) builds the OS notification itself, so it
 * controls the icon, groups repeats by id, and opens the in-app notification
 * history when tapped. A `notification` payload would make the browser show
 * its own copy as well (duplicates). `Urgency: high` asks the push service to
 * deliver right away even to a sleeping phone; TTL drops it after a day.
 *
 * The log row is written first so its id can travel in the push; if the send
 * fails the row is removed again, so the history never lists an offer that
 * nobody was sent.
 */
export const sendOfferBroadcast = async ({ models, title, body, couponCode, actor }) => {
  const cleanTitle = (title || "").trim();
  const cleanBody  = (body  || "").trim();
  if (!cleanTitle || !cleanBody) throw httpError("Both a title and a message are required");
  if (cleanTitle.length > 80)  throw httpError("Title must be 80 characters or fewer");
  if (cleanBody.length > 200)  throw httpError("Message must be 200 characters or fewer");
  const code = normalizeCouponCode(couponCode);

  const { User, NotificationLog, RestaurantProfile } = models;

  // Best-effort snapshot for the admin's history list — not a delivery
  // receipt. FCM topic sends don't report per-device delivery back to us.
  const [recipientCount, profile] = await Promise.all([
    User.countDocuments({ pushTokens: { $exists: true, $not: { $size: 0 } } }),
    RestaurantProfile.findOne().select("logo restaurantName").lean(),
  ]);

  const log = await NotificationLog.create({
    title: cleanTitle, body: cleanBody, couponCode: code, sentBy: actor, recipientCount,
  });

  try {
    await admin.messaging().send({
      topic: OFFERS_TOPIC,
      data: {                              // FCM data values must all be strings
        id:         String(log._id),
        title:      cleanTitle,
        body:       cleanBody,
        couponCode: code,
        icon:       isHttpUrl(profile?.logo) ? profile.logo : "",
        url:        "/notifications",
      },
      webpush: { headers: { Urgency: "high", TTL: String(PUSH_TTL_SECONDS) } },
    });
  } catch (err) {
    await NotificationLog.deleteOne({ _id: log._id }).catch(() => {});
    console.error("Offer broadcast failed:", err.message);
    throw httpError("Couldn't send the notification — please try again", 502);
  }

  return log;
};

/**
 * A customer's notification history: the most recent offer broadcasts plus
 * how many arrived since they last opened the list. Only customer-safe fields
 * — never who sent it or how many received it.
 */
export const listCustomerNotifications = async ({ models, userId }) => {
  const { User, NotificationLog } = models;
  const user = await User.findById(userId).select("notificationsSeenAt createdAt").lean();
  // Never opened the list yet → only offers since they joined count as new.
  const seenAt = user?.notificationsSeenAt || user?.createdAt || new Date(0);
  const notifications = await NotificationLog.find()
    .sort({ createdAt: -1 })
    .limit(CUSTOMER_HISTORY_LIMIT)
    .select("title body couponCode createdAt")
    .lean();
  const unreadCount = notifications.filter((n) => n.createdAt > seenAt).length;
  return { notifications, unreadCount, seenAt };
};

export const markCustomerNotificationsSeen = ({ models, userId }) =>
  models.User.updateOne({ _id: userId }, { $set: { notificationsSeenAt: new Date() } });

export const listNotificationHistory = ({ models }) =>
  models.NotificationLog.find().sort({ createdAt: -1 }).limit(30);

export const countSubscribedCustomers = ({ models }) =>
  models.User.countDocuments({ pushTokens: { $exists: true, $not: { $size: 0 } } });
