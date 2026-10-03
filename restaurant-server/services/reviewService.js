// services/reviewService.js
// ─────────────────────────────────────────────────────────────────────────────
// Customer ratings of staff, collected in the customer app right after an
// order is PAID. One submission can carry two ratings:
//   FOOD    → the chef who cooked it   (order.readyBy, else order.preparedBy)
//   SERVICE → the waiter who took it   (order.confirmedBy, else deliveredBy)
// Attribution is derived here from the order's own actor fields — never from
// the request — and the {order, kind} unique index makes a re-submit a no-op.
// A rating of 2★ or less, or a negative tag, marks the review a complaint that
// the owner closes with "Mark as looked into" (atomic, once).
// ─────────────────────────────────────────────────────────────────────────────
import { verifyGuestOrderToken } from "../utils/guestOrderToken.js";

export const REVIEW_TAGS = {
  FOOD:    { good: ["Tasty", "Hot", "Fresh", "Good portion"], bad: ["Cold food", "Too salty", "Too spicy", "Late"] },
  SERVICE: { good: ["Friendly", "Helpful", "Fast"], bad: ["Slow", "Rude", "Wrong order"] },
};
export const LOOKED_INTO_NOTES = ["Spoke to staff", "Customer called back", "Not staff's fault"];
const COMPLAINT_MAX_RATING = 2;

const fail = (message, statusCode) => { const err = new Error(message); err.statusCode = statusCode; throw err; };
const actorId = (a) => a?.id || null;

/** Which staff member each kind of rating belongs to (pure). */
export const attributeOrder = (order) => {
  const pick = (actors, role) => actors.find((a) => a?.id && a.role === role) || null;
  const chef = pick([order.readyBy, order.preparedBy], "CHEF");
  const waiter = pick([order.confirmedBy, order.deliveredBy, order.completedBy], "WAITER");
  return {
    FOOD: chef ? { id: actorId(chef), name: chef.name || "" } : null,
    SERVICE: waiter ? { id: actorId(waiter), name: waiter.name || "" } : null,
  };
};

/** Validates one { rating, tags } entry; returns a clean copy or null when absent. */
export const cleanRating = (kind, entry) => {
  if (entry == null || entry.rating == null) return null;
  const rating = Number(entry.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("Rating must be 1 to 5 stars", 400);
  const allowed = [...REVIEW_TAGS[kind].good, ...REVIEW_TAGS[kind].bad];
  const tags = [...new Set((Array.isArray(entry.tags) ? entry.tags : []).filter((tg) => allowed.includes(tg)))];
  const complaint = rating <= COMPLAINT_MAX_RATING || tags.some((tg) => REVIEW_TAGS[kind].bad.includes(tg));
  return { rating, tags, complaint };
};

// Same ownership rule as editing/cancelling an order: the logged-in customer
// who placed it, or a guest holding that order's guest token. Staff can't rate.
const assertCanRate = (req, order) => {
  if (req.user) {
    const owner = order.user?._id ?? order.user;
    if (!owner || String(owner) !== String(req.user._id)) fail("You can only rate your own order", 403);
    return;
  }
  if (!verifyGuestOrderToken(req.headers["x-guest-order-token"], order._id)) fail("You can only rate your own order", 403);
};

const firstName = (name = "") => name.trim().split(/\s+/)[0] || "";

/** What the customer app needs to show the rating card for one order. */
export const getOrderReviewState = async ({ Order, StaffReview, req, orderId }) => {
  const order = await Order.findById(orderId);
  if (!order) fail("Order not found", 404);
  assertCanRate(req, order);
  const existing = await StaffReview.find({ order: order._id }).select("kind rating");
  const who = attributeOrder(order);
  return {
    canRate: order.paymentStatus === "PAID" && order.status !== "CANCELLED",
    rated: existing.length > 0,
    // First name only — the customer sees "Service by Rahul", never a full name.
    waiterName: who.SERVICE ? firstName(who.SERVICE.name) : "",
    chefName: who.FOOD ? firstName(who.FOOD.name) : "",
    tags: REVIEW_TAGS,
  };
};

/** Customer submits { food: {rating, tags}, service: {rating, tags}, comment }. */
export const submitOrderReview = async ({ Order, StaffReview, req, orderId, food, service, comment }) => {
  const order = await Order.findById(orderId);
  if (!order) fail("Order not found", 404);
  assertCanRate(req, order);
  if (order.paymentStatus !== "PAID" || order.status === "CANCELLED") fail("You can rate an order once it is paid", 409);

  const entries = { FOOD: cleanRating("FOOD", food), SERVICE: cleanRating("SERVICE", service) };
  if (!entries.FOOD && !entries.SERVICE) fail("Pick at least one star rating", 400);

  const who = attributeOrder(order);
  const text = String(comment || "").trim().slice(0, 500);
  const base = {
    order: order._id,
    orderNo: order.orderId || "",
    comment: text,
    customerName: req.user?.name || order.guestName || "Guest",
    tableNo: order.tableNo ?? null,
  };
  const docs = Object.entries(entries).filter(([, e]) => e).map(([kind, e]) => ({
    ...base, kind, ...e,
    employee: who[kind]?.id || null,
    employeeRole: who[kind] ? (kind === "FOOD" ? "chef" : "waiter") : "",
  }));

  let created = 0;
  for (const doc of docs) {
    try { await StaffReview.create(doc); created++; }
    catch (err) { if (err?.code !== 11000) throw err; } // already rated this kind — keep the first
  }
  if (!created) fail("You've already rated this order", 409);
  return { created };
};

/** Admin: one person's reviews + their rating summary. */
export const listEmployeeReviews = async ({ StaffReview, employeeId, filter = "all" }) => {
  const all = await StaffReview.find({ employee: employeeId }).sort({ createdAt: -1 }).limit(200).lean();
  const count = all.length;
  const avg = count ? Math.round((all.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null;
  const reviews = filter === "praise" ? all.filter((r) => !r.complaint)
    : filter === "complaints" ? all.filter((r) => r.complaint) : all;
  return {
    reviews,
    summary: { count, avg, praise: all.filter((r) => !r.complaint).length, openComplaints: all.filter((r) => r.complaint && !r.lookedInto).length },
  };
};

/** Admin: close a complaint — atomic, so it can only be closed once. */
export const markLookedInto = async ({ StaffReview, reviewId, note, actor }) => {
  const clean = String(note || "").trim().slice(0, 200);
  if (!clean) fail("Say what you did", 400);
  const updated = await StaffReview.findOneAndUpdate(
    { _id: reviewId, complaint: true, lookedInto: null },
    { $set: { lookedInto: { at: new Date(), by: actor, note: clean } } },
    { returnDocument: "after" },
  );
  if (updated) return updated;
  const exists = await StaffReview.findById(reviewId);
  if (!exists) fail("Review not found", 404);
  if (!exists.complaint) fail("Only complaints can be marked as looked into", 400);
  fail("This complaint was already looked into", 409);
};

/** Per-employee rating summary for the list ({ [id]: { avg, count, openComplaints } }). */
export const reviewSummaryByEmployee = async ({ StaffReview }) => {
  const rows = await StaffReview.aggregate([
    { $match: { employee: { $ne: null } } },
    { $group: {
      _id: "$employee",
      count: { $sum: 1 },
      total: { $sum: "$rating" },
      openComplaints: { $sum: { $cond: [{ $and: ["$complaint", { $eq: ["$lookedInto", null] }] }, 1, 0] } },
    } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), {
    count: r.count, avg: Math.round((r.total / r.count) * 10) / 10, openComplaints: r.openComplaints,
  }]));
};
