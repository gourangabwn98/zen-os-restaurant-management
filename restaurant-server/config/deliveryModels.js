// config/deliveryModels.js
// ─────────────────────────────────────────────────────────────────────────────
// Home-delivery collections. Merged into getModels() (config/getModels.js), so
// req.models.DeliveryJob etc. work like every other model. None of these
// duplicate an existing entity: a rider is a User (role "delivery"), an order
// is an Order — these hold only what the delivery itself needs.
//
//   DeliveryPartnerState  one per rider: online, capacity in use, last fix
//   DeliveryJob           one per order (unique) — the delivery lifecycle
//   DeliveryOffer         one per (job, rider, round) — idempotent broadcast
//   DeliveryLocation      GPS breadcrumbs, auto-deleted after 7 days (TTL)
//   DeliveryEvent         append-only audit trail (read-only once written)
//   CodCollection         one per COD order (unique): cash the rider collected
//                         at hand-over, until an admin verifies the hand-in
//
// Every concurrent write is an atomic conditional update (see
// services/deliveryService.js) — never a read-then-save().
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import { DELIVERY_JOB_STATUSES, DELIVERY_OFFER_STATUSES } from "../utils/deliveryStateMachine.js";

const { ObjectId } = mongoose.Schema.Types;

export const LOCATION_RETENTION_DAYS = 7;

const deliveryActorSchema = new mongoose.Schema({
  id:   { type: ObjectId, ref: "User", default: null },
  role: { type: String, default: "SYSTEM" }, // ADMIN | DELIVERY | SYSTEM
  name: { type: String, default: "" },
}, { _id: false });

const fixSchema = new mongoose.Schema({
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy:  { type: Number, default: null },
  speed:     { type: Number, default: null },
  heading:   { type: Number, default: null },
  at:        { type: Date, required: true },   // device time of the fix
}, { _id: false });

// ── Rider state ──────────────────────────────────────────────────────────────
// `activeCount` is the capacity in use. It only ever changes by an atomic
// $inc guarded in the filter (accept: activeCount < capacity), always in the
// same transaction as the job change, and every change bumps `capVersion` so
// the tick's drift repair can't overwrite a concurrent accept.
const deliveryPartnerStateSchema = new mongoose.Schema({
  partner:      { type: ObjectId, ref: "User", required: true, unique: true },
  online:       { type: Boolean, default: false },
  onlineSince:  { type: Date, default: null },
  lastSeenAt:   { type: Date, default: null },     // any heartbeat / location post
  activeCount:  { type: Number, default: 0, min: 0 },
  capVersion:   { type: Number, default: 0 },
  capacity:     { type: Number, default: null, min: 1, max: 10 }, // null → restaurant default
  suspended:       { type: Boolean, default: false },
  suspendedReason: { type: String, default: "" },
  suspendedAt:     { type: Date, default: null },
  suspendedBy:     { type: deliveryActorSchema, default: null },
  lastLocation: { type: fixSchema, default: null },
  fcmTokens:    { type: [String], default: [] },
}, { timestamps: true });
deliveryPartnerStateSchema.index({ online: 1, suspended: 1 });

// ── The delivery of one order ────────────────────────────────────────────────
const deliveryJobSchema = new mongoose.Schema({
  order:       { type: ObjectId, ref: "Order", required: true, unique: true },
  orderNo:     { type: String, default: "" },
  status:      { type: String, enum: DELIVERY_JOB_STATUSES, default: "SEARCHING" },
  partner:     { type: ObjectId, ref: "User", default: null },
  partnerName: { type: String, default: "" },

  // Broadcast rounds (services/deliveryService.js broadcastJob / tick).
  round:          { type: Number, default: 0 },
  offerExpiresAt: { type: Date, default: null },
  escalated:      { type: Boolean, default: false },
  escalatedAt:    { type: Date, default: null },

  // Snapshots taken when the job is created — later profile/address edits
  // never move a delivery that is already under way.
  pickup: {
    name:      { type: String, default: "" },
    address:   { type: String, default: "" },
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  drop: {
    address:      { type: String, default: "" },
    landmark:     { type: String, default: "" },
    latitude:     { type: Number, default: null },
    longitude:    { type: Number, default: null },
    contactName:  { type: String, default: "" },
    contactPhone: { type: String, default: "" },
  },
  distanceMeters: { type: Number, default: null }, // straight line, restaurant → drop
  // Cash on Delivery: the rider must collect cash at hand-over (snapshot at
  // job creation; the amount itself is always re-read from the order).
  cod: { type: Boolean, default: false },

  // Hand-over code. select:false — only the owner endpoint and the verify
  // step ever read it; it is never in a list, socket payload or log.
  otpCode:     { type: String, default: "", select: false },
  otpAttempts: { type: Number, default: 0 },

  // Tracking link (utils/delivery.js signTrackingToken). Bump to revoke.
  trackingVersion:   { type: Number, default: 0 },
  trackingRevokedAt: { type: Date, default: null },

  assignedAt:          { type: Date, default: null },
  assignedBy:          { type: deliveryActorSchema, default: null },
  arrivedRestaurantAt: { type: Date, default: null },
  pickedUpAt:          { type: Date, default: null },
  arrivedCustomerAt:   { type: Date, default: null },
  deliveredAt:         { type: Date, default: null },
  failedAt:            { type: Date, default: null },
  failReason:          { type: String, default: "" },
  cancelledAt:         { type: Date, default: null },
  cancelReason:        { type: String, default: "" },
}, { timestamps: true });
deliveryJobSchema.index({ status: 1, offerExpiresAt: 1 });
deliveryJobSchema.index({ partner: 1, status: 1 });
deliveryJobSchema.index({ createdAt: -1 });

// ── One offer to one rider in one round ──────────────────────────────────────
// The unique index is what makes a re-broadcast (or two server instances
// running the tick) unable to notify the same rider twice for the same round.
const deliveryOfferSchema = new mongoose.Schema({
  job:         { type: ObjectId, ref: "DeliveryJob", required: true },
  partner:     { type: ObjectId, ref: "User", required: true },
  round:       { type: Number, required: true },
  status:      { type: String, enum: DELIVERY_OFFER_STATUSES, default: "SENT" },
  expiresAt:   { type: Date, required: true },
  respondedAt: { type: Date, default: null },
}, { timestamps: true });
deliveryOfferSchema.index({ job: 1, partner: 1, round: 1 }, { unique: true });
deliveryOfferSchema.index({ partner: 1, status: 1, expiresAt: 1 });
deliveryOfferSchema.index({ status: 1, expiresAt: 1 });

// ── GPS breadcrumbs ──────────────────────────────────────────────────────────
// Written only while the rider has an active delivery (privacy: no history of
// where an idle rider goes). Expire by SERVER receive time, not device time.
const deliveryLocationSchema = new mongoose.Schema({
  partner:  { type: ObjectId, ref: "User", required: true },
  jobs:     [{ type: ObjectId, ref: "DeliveryJob" }],
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy:  { type: Number, default: null },
  speed:     { type: Number, default: null },
  heading:   { type: Number, default: null },
  at:        { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
});
deliveryLocationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: LOCATION_RETENTION_DAYS * 24 * 3600 });
deliveryLocationSchema.index({ partner: 1, at: -1 });

// ── Audit trail ──────────────────────────────────────────────────────────────
const deliveryEventSchema = new mongoose.Schema({
  job:     { type: ObjectId, ref: "DeliveryJob", default: null },
  order:   { type: ObjectId, ref: "Order", default: null },
  partner: { type: ObjectId, ref: "User", default: null },
  type:    { type: String, required: true },   // e.g. JOB_CREATED, OFFERED, ACCEPTED, PICKED_UP, OTP_FAILED …
  actor:   { type: deliveryActorSchema, default: () => ({}) },
  at:      { type: Date, default: Date.now },
  data:    { type: mongoose.Schema.Types.Mixed, default: null }, // never OTPs or tokens
});
deliveryEventSchema.index({ job: 1, at: 1 });
deliveryEventSchema.index({ partner: 1, at: -1 });
deliveryEventSchema.index({ at: -1 });
deliveryEventSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"],
  function () { throw new Error("Delivery events are read-only"); },
);

// ── Cash on Delivery collection ──────────────────────────────────────────────
// Written by the rider's OTP hand-over (same transaction as DELIVERED) — the
// rider's custody of the cash, NOT a payment: the order stays unpaid until an
// admin/manager verifies the hand-in, which runs the existing billing settle
// (billingService.settleBills, Cash) → PAID + SETTLED → COMPLETED.
// Unique on `order`: a second collection for the same order is impossible.
export const COD_STATUSES = ["COLLECTED", "VERIFYING", "VERIFIED", "DISPUTED"];
const codCollectionSchema = new mongoose.Schema({
  order:       { type: ObjectId, ref: "Order", required: true, unique: true },
  orderNo:     { type: String, default: "" },
  job:         { type: ObjectId, ref: "DeliveryJob", required: true },
  partner:     { type: ObjectId, ref: "User", required: true },
  partnerName: { type: String, default: "" },
  amount:      { type: Number, required: true },   // ₹ = order.total at hand-over (server-derived)
  collectedAt: { type: Date, required: true },
  status:      { type: String, enum: COD_STATUSES, default: "COLLECTED" },
  verifiedAt:  { type: Date, default: null },
  verifiedBy:  { type: deliveryActorSchema, default: null },
  disputedAt:  { type: Date, default: null },
  disputedBy:  { type: deliveryActorSchema, default: null },
  disputeReason: { type: String, default: "" },
  note:        { type: String, default: "" },
}, { timestamps: true });
codCollectionSchema.index({ status: 1, collectedAt: -1 });
codCollectionSchema.index({ partner: 1, status: 1 });

export const getDeliveryModels = (conn) => ({
  DeliveryPartnerState: conn.models.DeliveryPartnerState || conn.model("DeliveryPartnerState", deliveryPartnerStateSchema),
  DeliveryJob:          conn.models.DeliveryJob          || conn.model("DeliveryJob",          deliveryJobSchema),
  DeliveryOffer:        conn.models.DeliveryOffer        || conn.model("DeliveryOffer",        deliveryOfferSchema),
  DeliveryLocation:     conn.models.DeliveryLocation     || conn.model("DeliveryLocation",     deliveryLocationSchema),
  DeliveryEvent:        conn.models.DeliveryEvent        || conn.model("DeliveryEvent",        deliveryEventSchema),
  CodCollection:        conn.models.CodCollection        || conn.model("CodCollection",        codCollectionSchema),
});
