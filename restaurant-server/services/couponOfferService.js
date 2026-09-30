// services/couponOfferService.js
// ─────────────────────────────────────────────────────────────────────────────
// Announces a coupon to registered customers as an offer push, reusing the
// Offers broadcast (services/notificationService.js) rather than a second
// push path: the offer is SCHEDULED for the coupon's start date (or sent now
// if it has already started), expires with the coupon, and lands in each
// customer's notification history with the code. Only registered customers
// can get it — push opt-in requires a login — so a GUEST-only coupon is never
// announced.
//
// Kept out of couponService.js on purpose: that one is imported by
// orderService, and notificationService loads Firebase Admin.
//
// A push that already went out can't be recalled; a still-SCHEDULED one is
// cancelled (atomically, via cancelScheduledOffer) whenever the coupon is
// changed, paused or deleted, and re-created with the new details if the
// admin still wants it announced.
// ─────────────────────────────────────────────────────────────────────────────
import { createCoupon, updateCoupon, deleteCoupon } from "./couponService.js";
import { sendOfferBroadcast, cancelScheduledOffer, OFFER_STATUS } from "./notificationService.js";

const describe = (c) => (c.discountType === "PERCENT"
  ? `${c.discountValue}% off${c.maxDiscount ? ` (up to ₹${c.maxDiscount})` : ""}`
  : `₹${c.discountValue} off`);

/** Push body: the coupon's own description, then how to use it (≤ 200 chars). */
export const couponPushBody = (c) => {
  const how = `Use code ${c.code} for ${describe(c)}${c.minOrderAmount ? ` on orders above ₹${c.minOrderAmount}` : ""}.`;
  const desc = (c.description || "").trim();
  if (!desc) return how;
  const room = 200 - how.length - 1;
  return room > 10 ? `${desc.length > room ? `${desc.slice(0, room - 1)}…` : desc} ${how}` : how.slice(0, 200);
};

/** Can this coupon be announced at all right now? */
const canAnnounce = (c, now) =>
  c.isActive && c.audience !== "GUEST" && new Date(c.endsAt) > now;

/** Cancels the coupon's announcement if it hasn't gone out yet. */
const cancelPending = async ({ models, coupon }) => {
  if (!coupon.notification) return;
  const log = await models.NotificationLog.findById(coupon.notification).select("status").lean();
  if (log?.status !== OFFER_STATUS.SCHEDULED) return;
  try {
    await cancelScheduledOffer({ models, id: coupon.notification });
  } catch (err) {
    if (err.statusCode !== 409) throw err; // 409 = the scheduler sent it a moment ago
  }
};

/** Schedules/sends the announcement and links it to the coupon. Returns a
 * warning string instead of throwing if the push service refuses — the
 * coupon itself is already saved and usable. */
const announce = async ({ models, coupon, actor, now }) => {
  try {
    const log = await sendOfferBroadcast({
      models, now, actor,
      title: coupon.title,
      body: couponPushBody(coupon),
      couponCode: coupon.code,
      startsAt: new Date(coupon.startsAt) > now ? coupon.startsAt : null,
      expiresAt: coupon.endsAt,
    });
    await models.Coupon.updateOne({ _id: coupon._id }, { $set: { notification: log._id } });
    return { notification: log, warning: "" };
  } catch (err) {
    return { notification: null, warning: `Coupon saved, but the notification couldn't be sent: ${err.message}` };
  }
};

const withNotification = async (models, id) =>
  models.Coupon.findById(id).populate("notification", "status startsAt sentAt error").lean();

/** Admin creates a coupon; `notify` announces it to registered customers. */
export const createCouponWithNotice = async ({ models, body, actor, now = new Date() }) => {
  const coupon = await createCoupon({ models, body, actor });
  let warning = "";
  if (body.notify) {
    await models.Coupon.updateOne({ _id: coupon._id }, { $set: { announce: true } });
    if (canAnnounce(coupon, now)) ({ warning } = await announce({ models, coupon, actor, now }));
    else if (coupon.audience === "GUEST") warning = "Guest-only coupons can't be sent as a notification — only registered customers receive them.";
  }
  return { coupon: await withNotification(models, coupon._id), warning };
};

/**
 * Admin edits a coupon. A not-yet-sent announcement is always cancelled
 * (its title/dates may be stale) and, if `notify` is still wanted and the
 * coupon can be announced, re-created from the new details. One that was
 * already SENT is left alone — it can't be recalled, and sending it twice
 * would spam customers.
 */
export const updateCouponWithNotice = async ({ models, id, body, actor, now = new Date() }) => {
  const before = await models.Coupon.findById(id).populate("notification", "status").lean();
  const coupon = await updateCoupon({ models, id, body });
  const sentAlready = [OFFER_STATUS.SENT, OFFER_STATUS.SENDING].includes(before?.notification?.status);
  // Not sent in this request (e.g. Pause/Resume) → keep the admin's earlier choice.
  const wantNotify = body.notify === undefined ? Boolean(before?.announce) : Boolean(body.notify);
  if (body.notify !== undefined) await models.Coupon.updateOne({ _id: id }, { $set: { announce: wantNotify } });

  let warning = "";
  if (!sentAlready) {
    await cancelPending({ models, coupon: { notification: before?.notification?._id } });
    if (wantNotify && canAnnounce(coupon, now)) ({ warning } = await announce({ models, coupon, actor, now }));
    else await models.Coupon.updateOne({ _id: id }, { $set: { notification: null } });
  }
  return { coupon: await withNotification(models, id), warning };
};

/** Admin deletes a coupon — its pending announcement is cancelled too. */
export const deleteCouponWithNotice = async ({ models, id }) => {
  const deleted = await deleteCoupon({ models, id });
  await cancelPending({ models, coupon: deleted });
  return deleted;
};

