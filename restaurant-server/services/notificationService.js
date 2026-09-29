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
const MAX_PUSH_TTL_SECONDS = 24 * 60 * 60;       // an offer a day late is no longer useful
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const SEND_NOW_GRACE_MS = 60 * 1000;             // a start within the next minute = send now
const STALE_SENDING_MS = 10 * 60 * 1000;         // a claim older than this was interrupted
const MAX_DUE_PER_TICK = 20;
export const CUSTOMER_HISTORY_LIMIT = 50;

export const OFFER_STATUS = {
  SCHEDULED: "SCHEDULED", SENDING: "SENDING", SENT: "SENT", FAILED: "FAILED", CANCELLED: "CANCELLED",
};

/** "  diwali20 " → "DIWALI20"; "" → "" (no coupon). Throws 400 if malformed. */
export const normalizeCouponCode = (raw) => {
  const code = String(raw ?? "").trim().toUpperCase();
  if (!code) return "";
  if (!COUPON_RE.test(code)) throw httpError("Coupon code must be 3–20 characters: letters, numbers, - or _");
  return code;
};

const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

const parseOptionalDate = (raw, label) => {
  if (raw === undefined || raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw httpError(`${label} is not a valid date/time`);
  return d;
};

/**
 * Validates the offer window. Returns { startsAt, expiresAt } where
 * startsAt === null means "send now" (blank, in the past, or within the next
 * minute). Times arrive as ISO strings — the admin's browser converts its
 * local date/time, so no timezone guessing happens here.
 */
export const normalizeOfferTiming = ({ startsAt, expiresAt, now = new Date() }) => {
  let start = parseOptionalDate(startsAt, "Start time");
  const end = parseOptionalDate(expiresAt, "Expiry time");
  if (start && start.getTime() <= now.getTime() + SEND_NOW_GRACE_MS) start = null;
  if (start && start.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) throw httpError("Start time can be at most a year ahead");
  if (end && end.getTime() <= now.getTime()) throw httpError("Expiry time must be in the future");
  if (end && start && end.getTime() <= start.getTime()) throw httpError("Expiry time must be after the start time");
  return { startsAt: start, expiresAt: end };
};

/** Push TTL: never longer than a day, and never past the offer's expiry. */
const pushTtlSeconds = (expiresAt, now) => {
  if (!expiresAt) return MAX_PUSH_TTL_SECONDS;
  const left = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000);
  return Math.max(60, Math.min(MAX_PUSH_TTL_SECONDS, left));
};

const countSubscribers = (User) =>
  User.countDocuments({ pushTokens: { $exists: true, $not: { $size: 0 } } });

/**
 * Pushes one already-claimed (status SENDING) offer to the offers topic.
 *
 * Sent as a DATA-ONLY web-push message: the customer app's service worker
 * (public/firebase-messaging-sw.js) builds the OS notification itself, so it
 * controls the icon, groups repeats by id, and opens the in-app notification
 * history when tapped. A `notification` payload would make the browser show
 * its own copy as well (duplicates). `Urgency: high` asks the push service to
 * deliver right away even to a sleeping phone; the TTL stops a phone that was
 * off from showing an offer after it has expired.
 *
 * Throws if FCM rejects the send; the caller decides what that means.
 */
const pushOffer = async ({ models, log, now }) => {
  const { User, NotificationLog, RestaurantProfile } = models;
  // Best-effort snapshot for the admin's history list — not a delivery
  // receipt. FCM topic sends don't report per-device delivery back to us.
  const [recipientCount, profile] = await Promise.all([
    countSubscribers(User),
    RestaurantProfile.findOne().select("logo").lean(),
  ]);

  await admin.messaging().send({
    topic: OFFERS_TOPIC,
    data: {                                // FCM data values must all be strings
      id:         String(log._id),
      title:      log.title,
      body:       log.body,
      couponCode: log.couponCode || "",
      expiresAt:  log.expiresAt ? new Date(log.expiresAt).toISOString() : "",
      icon:       isHttpUrl(profile?.logo) ? profile.logo : "",
      url:        "/notifications",
    },
    webpush: { headers: { Urgency: "high", TTL: String(pushTtlSeconds(log.expiresAt, now)) } },
  });

  return NotificationLog.findOneAndUpdate(
    { _id: log._id, status: OFFER_STATUS.SENDING },
    { $set: { status: OFFER_STATUS.SENT, sentAt: now, recipientCount, error: "" } },
    { new: true },
  );
};

/**
 * Admin creates an offer. With no (or a past) start time it is pushed right
 * away; with a future start time it is stored as SCHEDULED and runDueOffers()
 * pushes it automatically at that time.
 *
 * Send-now: the log row is written first (status SENDING) so its id can
 * travel in the push; if FCM rejects the send the row is removed again, so
 * the history never lists an offer that nobody was sent.
 */
export const sendOfferBroadcast = async ({
  models, title, body, couponCode, startsAt, expiresAt, actor, now = new Date(),
}) => {
  const cleanTitle = (title || "").trim();
  const cleanBody  = (body  || "").trim();
  if (!cleanTitle || !cleanBody) throw httpError("Both a title and a message are required");
  if (cleanTitle.length > 80)  throw httpError("Title must be 80 characters or fewer");
  if (cleanBody.length > 200)  throw httpError("Message must be 200 characters or fewer");
  const code = normalizeCouponCode(couponCode);
  const timing = normalizeOfferTiming({ startsAt, expiresAt, now });

  const { NotificationLog, User } = models;
  const base = { title: cleanTitle, body: cleanBody, couponCode: code, sentBy: actor, expiresAt: timing.expiresAt };

  if (timing.startsAt) {
    return NotificationLog.create({
      ...base, status: OFFER_STATUS.SCHEDULED, startsAt: timing.startsAt,
      recipientCount: await countSubscribers(User), // refreshed at send time
    });
  }

  const log = await NotificationLog.create({ ...base, status: OFFER_STATUS.SENDING, startsAt: now, sendingAt: now });
  try {
    return await pushOffer({ models, log, now });
  } catch (err) {
    await NotificationLog.deleteOne({ _id: log._id }).catch(() => {});
    console.error("Offer broadcast failed:", err.message);
    throw httpError("Couldn't send the notification — please try again", 502);
  }
};

/** Admin cancels an offer that hasn't gone out yet. Atomic: loses cleanly
 * (409) to the scheduler if it was claimed for sending a moment earlier. */
export const cancelScheduledOffer = async ({ models, id }) => {
  const updated = await models.NotificationLog.findOneAndUpdate(
    { _id: id, status: OFFER_STATUS.SCHEDULED },
    { $set: { status: OFFER_STATUS.CANCELLED } },
    { new: true },
  );
  if (updated) return updated;
  const exists = await models.NotificationLog.exists({ _id: id });
  throw httpError(exists ? "This offer has already been sent or cancelled" : "Offer not found", exists ? 409 : 404);
};

/**
 * Background tick (server.js, every 30s): pushes every SCHEDULED offer whose
 * start time has arrived. Safe to run concurrently on several instances —
 * each offer is claimed with one atomic SCHEDULED → SENDING update, so only
 * one caller ever pushes it.
 *
 * At-most-once, deliberately: a claim left in SENDING (server crashed
 * mid-send) is marked FAILED, never retried — FCM can't tell us whether the
 * push already went out, and a duplicate marketing push is worse than a
 * missed one the admin can simply send again. An offer that expired before
 * it could be sent (server was down through its whole window) is FAILED too.
 */
export const runDueOffers = async ({ models, now = new Date() }) => {
  const { NotificationLog } = models;

  // One-time backfill for offers sent before scheduling existed (no status):
  // they were sent immediately at createdAt. Idempotent — matches nothing
  // once done.
  await NotificationLog.updateMany(
    { status: { $exists: false } },
    [{ $set: { status: OFFER_STATUS.SENT, sentAt: "$createdAt", startsAt: "$createdAt" } }],
  );

  const stale = await NotificationLog.updateMany(
    { status: OFFER_STATUS.SENDING, sendingAt: { $lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    { $set: { status: OFFER_STATUS.FAILED, error: "Sending was interrupted — send it again if needed" } },
  );

  const results = { sent: 0, failed: 0, interrupted: stale?.modifiedCount || 0 };
  for (let i = 0; i < MAX_DUE_PER_TICK; i++) {
    const log = await NotificationLog.findOneAndUpdate(
      { status: OFFER_STATUS.SCHEDULED, startsAt: { $lte: now } },
      { $set: { status: OFFER_STATUS.SENDING, sendingAt: now } },
      { sort: { startsAt: 1 }, new: true },
    );
    if (!log) break;

    if (log.expiresAt && new Date(log.expiresAt) <= now) {
      await NotificationLog.updateOne(
        { _id: log._id, status: OFFER_STATUS.SENDING },
        { $set: { status: OFFER_STATUS.FAILED, error: "Expired before it could be sent (server was offline)" } },
      );
      results.failed++;
      continue;
    }

    try {
      await pushOffer({ models, log, now });
      results.sent++;
    } catch (err) {
      console.error(`Scheduled offer ${log._id} failed:`, err.message);
      await NotificationLog.updateOne(
        { _id: log._id, status: OFFER_STATUS.SENDING },
        { $set: { status: OFFER_STATUS.FAILED, error: `Push service error: ${err.message}`.slice(0, 300) } },
      );
      results.failed++;
    }
  }
  return results;
};

/**
 * A customer's notification history: offers that were actually SENT (never
 * scheduled/cancelled ones), newest first, plus how many arrived since they
 * last opened the list. Only customer-safe fields — never who sent it or how
 * many received it. `serverNow` lets the app judge expiry by server time, not
 * a phone clock that may be wrong.
 */
export const listCustomerNotifications = async ({ models, userId, now = new Date() }) => {
  const { User, NotificationLog } = models;
  const user = await User.findById(userId).select("notificationsSeenAt createdAt").lean();
  // Never opened the list yet → only offers since they joined count as new.
  const seenAt = user?.notificationsSeenAt || user?.createdAt || new Date(0);
  const notifications = await NotificationLog.find({ status: OFFER_STATUS.SENT })
    .sort({ sentAt: -1 })
    .limit(CUSTOMER_HISTORY_LIMIT)
    .select("title body couponCode sentAt expiresAt")
    .lean();
  const unreadCount = notifications.filter((n) => new Date(n.sentAt) > new Date(seenAt)).length;
  return { notifications, unreadCount, seenAt, serverNow: now };
};

export const markCustomerNotificationsSeen = ({ models, userId }) =>
  models.User.updateOne({ _id: userId }, { $set: { notificationsSeenAt: new Date() } });

/** Admin list: upcoming scheduled offers first (soonest first), then the
 * most recent of everything else. */
export const listNotificationHistory = async ({ models }) => {
  const { NotificationLog } = models;
  const [scheduled, recent] = await Promise.all([
    NotificationLog.find({ status: OFFER_STATUS.SCHEDULED }).sort({ startsAt: 1 }).limit(50).lean(),
    NotificationLog.find({ status: { $ne: OFFER_STATUS.SCHEDULED } }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  return [...scheduled, ...recent];
};

export const countSubscribedCustomers = ({ models }) => countSubscribers(models.User);
