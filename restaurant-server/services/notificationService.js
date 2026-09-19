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

/** Admin-triggered broadcast to every opted-in customer. */
export const sendOfferBroadcast = async ({ models, title, body, actor }) => {
  const cleanTitle = (title || "").trim();
  const cleanBody  = (body  || "").trim();
  if (!cleanTitle || !cleanBody) {
    const err = new Error("Both a title and a message are required");
    err.statusCode = 400;
    throw err;
  }

  const { User, NotificationLog } = models;

  // Best-effort snapshot for the admin's history list — not a delivery
  // receipt. FCM topic sends don't report per-device delivery back to us.
  const recipientCount = await User.countDocuments({
    pushTokens: { $exists: true, $not: { $size: 0 } },
  });

  await admin.messaging().send({
    topic: OFFERS_TOPIC,
    notification: { title: cleanTitle, body: cleanBody },
  });

  return NotificationLog.create({
    title: cleanTitle, body: cleanBody, sentBy: actor, recipientCount,
  });
};

export const listNotificationHistory = ({ models }) =>
  models.NotificationLog.find().sort({ createdAt: -1 }).limit(30);

export const countSubscribedCustomers = ({ models }) =>
  models.User.countDocuments({ pushTokens: { $exists: true, $not: { $size: 0 } } });
