// config/getModels.js
// ─────────────────────────────────────────────────────────────────────────────
// Returns Mongoose models bound to a specific restaurant's DB connection.
// Call this in every controller using: const { User, Order, ... } = getModels(req.db)
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import { ORDER_STATUSES, ORDER_SOURCES, ORDER_TYPES } from "../utils/orderStateMachine.js";
import { STOCK_UNITS, LEDGER_TYPES, WASTAGE_REASONS } from "../utils/inventoryConstants.js";
import { nextOrderId } from "../utils/orderNumber.js";
import { INGREDIENT_SOURCES } from "../utils/recipeCost.js";

// ── Atomic counters ──────────────────────────────────────────────────────────
// One document per sequence (currently just "orderId"). Incremented with a
// single atomic `$inc` so concurrent order placement can never mint the same
// number twice — see utils/orderNumber.js for the full rationale.
const counterSchema = new mongoose.Schema({
  _id: { type: String },        // sequence name, e.g. "orderId"
  seq: { type: Number, default: 0 },
}, { versionKey: false });

// ── Schema definitions ────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  name:       { type: String, trim: true },
  phone:      { type: String, unique: true, sparse: true, trim: true },
  email:      { type: String, unique: true, sparse: true, lowercase: true },
  password:   { type: String },
  otp:        { type: String },
  otpExpiry:  { type: Date },
  isVerified: { type: Boolean, default: false },
  vegMode:    { type: Boolean, default: false },
  language:   { type: String, default: "English" },
  // ── Admin/staff panel UI preference ──────────────────────────────────────
  // Same shape as vegMode/language: a per-user setting with its own PATCH
  // endpoint (PATCH /api/auth/theme). "system" follows the device's
  // prefers-color-scheme. Purely cosmetic — never gates any behaviour.
  themePreference: { type: String, enum: ["light","dark","system"], default: "system" },
  isAdmin:    { type: Boolean, default: false },
  role:       { type: String, enum: ["admin","waiter","chef","customer"], default: "customer" },
  address:    { type: String, default: "" }, // employee address (Employee Management)
  waiterName: { type: String },
  // ── RBAC / staff account lifecycle (Phase 1) ──────────────────────────────
  // Lets an admin deactivate a waiter's access without deleting the account.
  status:     { type: String, enum: ["Active","Inactive"], default: "Active" },
  lastLoginAt:{ type: Date },
  // ── Push notification opt-in (offers broadcast) ───────────────────────────
  // One customer may have several devices/browsers subscribed at once (phone
  // + laptop), so this is an array, not a single token. Populated only via
  // services/notificationService.js — never written directly by a
  // controller — so subscribe/unsubscribe always stays in sync with the
  // matching Firebase Cloud Messaging topic subscription.
  pushTokens: { type: [String], default: [] },
  // Customer's notification-history "read up to" marker: broadcasts newer
  // than this count as unread (GET /api/notifications).
  notificationsSeenAt: { type: Date, default: null },
  // ── Staff HR record (Employees page → Pay / Documents) ────────────────────
  // Only ever written through employeeService.updateEmployee's whitelist.
  // ID proof keeps the type + last 4 digits only — never the full number.
  hr: {
    type: new mongoose.Schema({
      salary:         { type: Number, default: 0, min: 0 },   // ₹ per month
      otRate:         { type: Number, default: 0, min: 0 },   // ₹ per overtime hour
      shiftHours:     { type: Number, default: 8, min: 1, max: 16 }, // daily hours before overtime
      joinedAt:       { type: Date, default: null },
      idProofType:    { type: String, default: "" },
      idProofLast4:   { type: String, default: "" },
      emergencyName:  { type: String, default: "" },
      emergencyPhone: { type: String, default: "" },
      photo:          { type: String, default: "" },
      payoutUpi:      { type: String, default: "" },
      payoutBank:     { type: String, default: "" },
    }, { _id: false }),
    default: () => ({}),
  },
}, { timestamps: true });

// Small reusable "who did this" subdocument — used for audit fields on Order.
const actorSchema = new mongoose.Schema({
  id:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Broader than ORDER_SOURCES (which is specifically "who created the
  // order") — CHEF is a legitimate actor (e.g. preparedBy/readyBy) even
  // though a chef can never be an order's source.
  role: { type: String, enum: [...ORDER_SOURCES, "CHEF", "GUEST"], default: null },
  name: { type: String, default: "" },
}, { _id: false });

const restaurantProfileSchema = new mongoose.Schema({
  restaurantName:    { type: String, required: true, trim: true },
  phone:             { type: String, default: "" },
  email:             { type: String, default: "" },
  contactPerson:     { type: String, default: "" },
  gstRate:           { type: Number, default: 0 },
  serviceCharge:     { type: Number, default: 0 },
  packingCharge:     { type: Number, default: 0 },
  logo:              { type: String, default: "" },
  banners:           [{ imageUrl: String, link: String, active: { type: Boolean, default: true } }],
  printerIps:        [{ ip: String, name: { type: String, default: "Printer 1" }, active: { type: Boolean, default: true } }],
  address:           { type: String, default: "" },
  city:              { type: String, default: "" },
  latitude:          { type: Number, default: null },
  longitude:         { type: Number, default: null },
  dineInRange:       { type: Number, default: 200 },
  deliveryRange:     { type: Number, default: 5000 },
  fssaiNumber:       { type: String, default: "" },
  gstNumber:         { type: String, default: "" },
  aboutRestaurant:   { type: String, default: "" },
  openingTime:       { type: String, default: "09:00" },
  closingTime:       { type: String, default: "22:00" },
  avgDeliveryTime:   { type: Number, default: 30 },
  minOrderAmount:    { type: Number, default: 0 },
  freeDeliveryAbove: { type: Number, default: 300 },
  deliveryBaseFee:   { type: Number, default: 40 },
  deliveryFeePerKm:  { type: Number, default: 8 },
  socialInstagram:   { type: String, default: "" },
  socialFacebook:    { type: String, default: "" },
  website:           { type: String, default: "" },
  services: {
    dineIn:   { type: Boolean, default: true },
    takeAway: { type: Boolean, default: true },
    delivery: { type: Boolean, default: false },
  },
  notificationSound: { type: Boolean, default: true },
  // ── UPI payment (Phase 3) ─────────────────────────────────────────────────
  // Direct UPI intent/deep-link only — no payment gateway. Left empty until
  // an admin configures it; the customer app hides the "Pay via UPI" option
  // when this is blank and offers Cash-at-restaurant instead.
  upiId:             { type: String, default: "" },       // e.g. "restaurant@okhdfcbank"
  upiPayeeName:      { type: String, default: "" },        // shown in the UPI app; falls back to restaurantName
  // Static payment QR image (Cloudinary URL) uploaded by the admin, shown on
  // the staff bill so a customer can scan-and-pay. Like the UPI deep link, a
  // scan is never proof of payment — staff still mark the order paid.
  paymentQr:         { type: String, default: "" },
  // How customers may pay: CASH | ONLINE (pay before the order reaches staff)
  // | BOTH (customer picks). See utils/paymentMode.js.
  paymentMode:       { type: String, enum: ["CASH", "ONLINE", "BOTH"], default: "BOTH" },
  // Minutes a Placed (CONFIRMED) order stays editable before it moves to
  // PREPARING by itself and its KOT prints. 0 = straight to preparing.
  // See orderService.sendToKitchenTx / autoSendDueOrders.
  editWindowMinutes: { type: Number, default: 3, min: 0, max: 15 },
  // IANA timezone used to evaluate menu schedules (utils/menuSchedule.js).
  // An invalid value falls back to Asia/Kolkata at read time.
  timezone:          { type: String, default: "Asia/Kolkata" },
  // Staff rules (Employees → Pay / Leave). Admin-editable, never env vars.
  staffPolicy: {
    paidLeavePerMonth: { type: Number, default: 1, min: 0, max: 31 },
    salaryDay:         { type: Number, default: 5, min: 1, max: 28 },
  },
}, { timestamps: true });

// ── Scheduled menu visibility (utils/menuSchedule.js) ─────────────────────────
// One daily window per category/item, in the restaurant's timezone. Separate
// from `isAvailable`: customer visibility = isAvailable AND schedule allows now.
// Only ever written through PATCH /api/menu/schedule (validated there).
const menuScheduleSchema = new mongoose.Schema({
  enabled:   { type: Boolean, default: false },
  startTime: { type: String, default: "" },   // "HH:MM" 24h, inclusive
  endTime:   { type: String, default: "" },   // "HH:MM" 24h, exclusive; < start ⇒ crosses midnight
}, { _id: false });

const categorySchema = new mongoose.Schema({
  name:     { type: String, required: true, unique: true, trim: true },
  nameBn:   { type: String, default: "", trim: true, maxlength: 120 }, // optional Bengali name — display only
  image:    { type: String, default: "" },
  schedule: { type: menuScheduleSchema, default: () => ({}) },
}, { timestamps: true });

const chefSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  phone:     { type: String, required: true, unique: true },
  status:    { type: String, enum: ["Active","Inactive"], default: "Active" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
}, { timestamps: true });

const menuItemSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  nameBn:        { type: String, default: "", trim: true, maxlength: 120 }, // optional Bengali name (admin app bn mode)
  price:         { type: Number, required: true },
  originalPrice: { type: Number },
  description:   { type: String },
  category:      { type: String, required: true },
  categoryImage: { type: String, default: "" },
  tag:           { type: String, enum: ["Veg","Non Veg"], required: true },
  image:         { type: String, default: "" },
  isAvailable:   { type: Boolean, default: true },
  rating:        { type: Number, default: 4.0 },
  schedule:      { type: menuScheduleSchema, default: () => ({}) },
}, { timestamps: true });

const orderItemSchema = new mongoose.Schema({
  menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true },
  name:     { type: String, required: true },
  nameBn:   { type: String, default: "" }, // snapshot of MenuItem.nameBn, like `name`
  price:    { type: Number, required: true },
  qty:      { type: Number, required: true, min: 1 },
  notes:    { type: String, default: "" },
  // Recipe making cost of ONE of this item, snapshotted when the order goes
  // to the kitchen (inventoryService.deductStockForOrder) — Insights' COGS
  // uses this, so later stock-price or recipe changes never rewrite history.
  // null = no recipe at that time, or an order from before costing existed.
  makingCost: { type: Number, default: null },
});

const statusHistoryEntrySchema = new mongoose.Schema({
  status:    { type: String, enum: ORDER_STATUSES, required: true },
  changedBy: { type: actorSchema, default: () => ({}) },
  changedAt: { type: Date, default: Date.now },
  note:      { type: String, default: "" },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId:       { type: String, unique: true },
  user:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  isGuest:       { type: Boolean, default: false },
  items:         [orderItemSchema],
  subtotal:      { type: Number, required: true },
  tax:           { type: Number, required: true },
  serviceCharge: { type: Number, default: 0 },
  discount:      { type: Number, default: 0 },
  total:         { type: Number, required: true },
  // Snapshot of the coupon the customer applied (services/couponService.js).
  // Re-pricing an edited order re-applies THIS snapshot (utils/pricing.js),
  // so a later admin change to the coupon never alters a placed order;
  // `discount` above is the amount it actually took off.
  coupon: {
    type: new mongoose.Schema({
      code:           { type: String, required: true },
      title:          { type: String, default: "" },
      discountType:   { type: String, enum: ["PERCENT", "FLAT"], required: true },
      discountValue:  { type: Number, required: true },
      maxDiscount:    { type: Number, default: null },
      minOrderAmount: { type: Number, default: 0 },
    }, { _id: false }),
    default: null,
  },
  guestName:     { type: String, default: "" },
  guestPhone:    { type: String, default: "" },
  orderType:     { type: String, enum: ORDER_TYPES, default: "DINE_IN" },
  tableNo:       { type: Number, default: null },

  // ── Table / session management (Phase 1) ──────────────────────────────────
  tableSession:  { type: mongoose.Schema.Types.ObjectId, ref: "TableSession", default: null },
  // True only when a valid QR table token was presented at order time.
  // false does NOT block the order (keeps existing customer app working
  // without a token) — it's an audit signal for staff/reporting.
  tableVerified: { type: Boolean, default: false },

  // ── Who created it / central order-source tracking ────────────────────────
  source:        { type: String, enum: ORDER_SOURCES, required: true, default: "CUSTOMER" },
  createdBy:     { type: actorSchema, default: () => ({}) },

  status: {
    type: String,
    enum: ORDER_STATUSES,
    default: "PENDING_CONFIRMATION",
  },
  confirmedBy:   { type: actorSchema, default: null },
  confirmedAt:   { type: Date, default: null },
  // ── Employee activity tracking (Employee Management) ──────────────────────
  // Which SPECIFIC employee performed each stage — not just "a waiter" or
  // "a chef". Populated in services/orderService.js's transitionOrderStatusTx.
  preparedBy:    { type: actorSchema, default: null },
  preparingAt:   { type: Date, default: null },
  readyBy:       { type: actorSchema, default: null },
  readyAt:       { type: Date, default: null },
  deliveredBy:   { type: actorSchema, default: null },
  deliveredAt:   { type: Date, default: null },
  completedBy:   { type: actorSchema, default: null },
  completedAt:   { type: Date, default: null },
  cancelledBy:   { type: actorSchema, default: null },
  cancelledAt:   { type: Date, default: null },
  cancelReason:  { type: String, default: "" },
  statusHistory: { type: [statusHistoryEntrySchema], default: [] },

  paymentStatus:  { type: String, enum: ["PENDING_VERIFICATION","PAID","FAILED"], default: "PENDING_VERIFICATION" },
  paymentMethod:  { type: String, enum: ["Cash","Online"], default: "Cash" },

  // ── Online payment gateway (PhonePe) ─────────────────────────────────────
  // Present only for orders where the customer started an online payment. The
  // gateway result (via a checksum-verified callback OR our own signed status
  // query) is what flips paymentStatus → PAID — see services/paymentService.js.
  // `state` is the gateway attempt's own lifecycle, NOT the order's
  // paymentStatus: a FAILED attempt leaves paymentStatus at
  // PENDING_VERIFICATION so cash / a retry still works.
  payment: {
    provider:              { type: String, enum: ["NONE","PHONEPE"], default: "NONE" },
    merchantTransactionId: { type: String, default: "" },
    phonepeTransactionId:  { type: String, default: "" },
    state:                 { type: String, enum: ["CREATED","PENDING","SUCCESS","FAILED"], default: "CREATED" },
    amount:                { type: Number, default: 0 }, // paise, server-derived from order.total
    lastCheckedAt:         { type: Date, default: null },
    raw:                   { type: mongoose.Schema.Types.Mixed, default: null }, // last gateway code, no PII
  },

  rating:         { type: Number, min: 1, max: 5 },
  cancelDeadline: { type: Date },
  // Pay-first orders (status AWAITING_PAYMENT) are cancelled if still unpaid
  // after this — see orderService.expireUnpaidOrders.
  paymentDeadline: { type: Date, default: null },
  // Edit window of a Placed (CONFIRMED) order: it moves to PREPARING (KOT
  // prints) automatically at this time.
  autoPrepareAt:  { type: Date, default: null },
  // Why an automatic send to the kitchen failed (e.g. out of stock) — the
  // order then waits for staff instead of retrying forever.
  sendError:      { type: String, default: "" },
  // Bumped on every edit; edits must name the revision they started from
  // (optimistic concurrency — two people editing can't overwrite each other).
  revision:       { type: Number, default: 0 },
  notes:          { type: String, default: "" },
  waiterName:     { type: String, default: "" }, // legacy display field, kept for existing UI
  // Optional — staff-only (see services/orderService.js: never trusted from
  // a customer/guest request). Flows into the order's KOTJob so the Kitchen
  // Display can play a distinct alert tone for it.
  priority:       { type: String, enum: ["NORMAL","URGENT"], default: "NORMAL" },
  waiterId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // ── Idempotency (Phase 1) ──────────────────────────────────────────────────
  // Client (customer/waiter/admin UI) generates one key per "place order"
  // attempt (e.g. a uuid held in component state) and resends the same key
  // on retry/double-click. A unique partial index guarantees only the first
  // request actually creates a document; subsequent ones return the same order.
  //
  // IMPORTANT: no `default` here. It used to be `default: null`, which meant
  // every keyless order persisted `idempotencyKey: null` — and a partial/
  // sparse unique index still indexes an explicit `null`, so the *second*
  // keyless order ever placed collided on this index. That collision was then
  // mis-handled as "this order already exists" and a stale order was returned
  // as a false success. Leaving the field absent keeps keyless orders out of
  // the index entirely.
  idempotencyKey: { type: String },

  // ── Inventory (Phase 2) ─────────────────────────────────────────────────────
  // Whether recipe-based stock deduction has run for this order. Guarded by
  // an atomic conditional update in inventoryService.deductStockForOrder, so
  // it can only ever flip false→true once, no matter how many times
  // confirmation is retried/raced.
  stockDeducted:  { type: Boolean, default: false },
  stockReversed:  { type: Boolean, default: false },
  // Exact quantities actually deducted, captured at deduction time. Reversal
  // (on cancellation) replays THIS list rather than recomputing from the
  // current recipe, which may have changed since the order was confirmed.
  stockDeductions: {
    type: [{
      inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem" },
      name:          String,
      qty:           Number,
      unit:          String,
    }],
    default: [],
  },
}, { timestamps: true });

// Partial (not sparse) unique index: only orders that actually carry a string
// idempotency key are indexed, so keyless orders can never collide here.
orderSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }, name: "idempotencyKey_str_unique" },
);
orderSchema.index({ status: 1, createdAt: -1 });
// Newest-first lists and date-range filters (admin Orders "All", Invoices, Insights).
orderSchema.index({ createdAt: -1 });
orderSchema.index({ tableSession: 1 });
// PhonePe callbacks/status polls look an order up by its gateway txn id.
orderSchema.index(
  { "payment.merchantTransactionId": 1 },
  { partialFilterExpression: { "payment.merchantTransactionId": { $type: "string" } } },
);

// Order number: assigned here as a backstop for any `.save()` path, but always
// via the atomic counter (utils/orderNumber.js) — never the old racy
// countDocuments()+1. The single place orders are actually created
// (services/orderService.js placeOrderTx) is the primary caller.
orderSchema.pre("save", async function () {
  if (this.orderId) return;
  this.orderId = await nextOrderId({
    Counter: this.db.model("Counter"),
    Order: this.constructor,
  });
});

const tableSchema = new mongoose.Schema({
  tableNo: { type: Number, required: true, unique: true },
  seats:   { type: Number, required: true, default: 4 },
  status:  { type: String, enum: ["Active","Inactive"], default: "Active" },
  label:   { type: String },
  notes:   { type: String },
  qrUrl:   { type: String },
  qrCode:  { type: String },
  // ── Occupancy (Phase 4) ────────────────────────────────────────────────────
  // Distinct from `status` above (which means "this table exists/usable").
  // Driven entirely by TableSession open/close — never set directly by a
  // client — so it can't drift from what orders actually exist.
  occupancyStatus: { type: String, enum: ["AVAILABLE","OCCUPIED"], default: "AVAILABLE" },
  // ── QR table identification (Phase 1) ─────────────────────────────────────
  // Random secret embedded in the table's QR code (as `&t=`). Lets the
  // backend tell "a real QR scan at this table" apart from "someone guessed
  // a table number" for unauthenticated guest orders. Optional/soft for now
  // — see tableVerified above — so the current customer app (which doesn't
  // send it yet) keeps working unchanged.
  qrToken: { type: String, default: "" },
}, { timestamps: true });

const tableSessionSchema = new mongoose.Schema({
  table:     { type: mongoose.Schema.Types.ObjectId, ref: "Table", default: null },
  tableNo:   { type: Number, required: true },
  status:    { type: String, enum: ["OPEN","CLOSED"], default: "OPEN" },
  openedAt:  { type: Date, default: Date.now },
  closedAt:  { type: Date, default: null },
  openedBy:  { type: actorSchema, default: () => ({}) },
  closedBy:  { type: actorSchema, default: null },
  orders:    [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
}, { timestamps: true });

// Only one OPEN session per table at a time — prevents two concurrent
// "seatings" being tracked against the same table.
tableSessionSchema.index(
  { tableNo: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" } }
);

const kotJobSchema = new mongoose.Schema({
  // unique → this is the idempotency guard: only one KOT job can ever exist
  // per order, even under a race between two simultaneous confirm requests.
  order:      { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
  orderId:    { type: String },
  tableNo:    { type: Number, default: null },
  orderType:  { type: String, enum: ORDER_TYPES },
  items:      [{ name: String, nameBn: String, qty: Number, notes: String }],
  // Optional — lets a staff-placed order flag its KOT as urgent, so the
  // Kitchen Display can play a distinct, stronger alert tone for it.
  // Never settable by a customer/guest (see services/orderService.js).
  priority:   { type: String, enum: ["NORMAL","URGENT"], default: "NORMAL" },
  // ── Print lifecycle (Phase 5) ─────────────────────────────────────────────
  status:      { type: String, enum: ["PENDING","PRINTING","PRINTED","FAILED"], default: "PENDING" },
  printerId:   { type: mongoose.Schema.Types.ObjectId, ref: "PrinterDevice", default: null },
  attempts:    { type: Number, default: 0 },
  lastError:   { type: String, default: "" },
  printedAt:   { type: Date, default: null },
  createdBy:  { type: actorSchema, default: () => ({}) },
}, { timestamps: true });

// ── Bill print jobs (Phase 5) ───────────────────────────────────────────────
// Unlike KOTJob, this is deliberately NOT unique-per-order — a bill can be
// legitimately reprinted (e.g. customer wants another copy). Each "print
// bill" action creates its own distinct job; duplicate protection is by
// job _id (never re-print the same job twice), not by order.
const billPrintJobSchema = new mongoose.Schema({
  order:      { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  orderId:    { type: String, default: "" },
  tableNo:    { type: Number, default: null },
  orderType:  { type: String, enum: ORDER_TYPES },
  payload:    { type: mongoose.Schema.Types.Mixed, required: true }, // rendered bill breakdown (items/subtotal/tax/total/etc.)
  status:     { type: String, enum: ["PENDING","PRINTING","PRINTED","FAILED"], default: "PENDING" },
  printerId:  { type: mongoose.Schema.Types.ObjectId, ref: "PrinterDevice", default: null },
  attempts:   { type: Number, default: 0 },
  lastError:  { type: String, default: "" },
  printedAt:  { type: Date, default: null },
  createdBy:  { type: actorSchema, default: () => ({}) },
}, { timestamps: true });

// ── Printer devices (Phase 5) ───────────────────────────────────────────────
// A registered local print-service credential. The plaintext key is shown
// to the admin exactly once at creation time and never again — only its
// hash is stored, the same pattern as a password.
const printerDeviceSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true }, // e.g. "Kitchen KOT printer"
  keyHash:     { type: String, required: true, select: false },
  role:        { type: String, enum: ["KOT","BILL","BOTH"], default: "BOTH" },
  connectionType: { type: String, enum: ["LAN","USB"], default: "LAN" },
  // Informational only (for the admin UI) — the print-service's own local
  // config is the source of truth for actually talking to the printer.
  lanIp:       { type: String, default: "" },
  lanPort:     { type: Number, default: 9100 },
  usbPrinterName: { type: String, default: "" },
  status:      { type: String, enum: ["Active","Revoked"], default: "Active" },
  lastStatus:  { type: String, enum: ["online","offline","error"], default: "offline" },
  lastSeenAt:  { type: Date, default: null },
  lastError:   { type: String, default: "" },
}, { timestamps: true });

// ── Inventory (Phase 2) ────────────────────────────────────────────────────

const supplierSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  phone:      { type: String, default: "" },
  email:      { type: String, default: "" },
  address:    { type: String, default: "" },
  gstNumber:  { type: String, default: "" },
  notes:      { type: String, default: "" },
  status:     { type: String, enum: ["Active","Inactive"], default: "Active" },
}, { timestamps: true });

const inventoryItemSchema = new mongoose.Schema({
  name:           { type: String, required: true, trim: true },
  nameBn:         { type: String, default: "", trim: true, maxlength: 120 }, // optional Bengali name — display only
  unit:           { type: String, enum: STOCK_UNITS, required: true },
  category:       { type: String, default: "" },
  currentStock:   { type: Number, default: 0, min: 0 },
  reorderLevel:   { type: Number, default: 0 },   // at/below → "LOW"
  criticalLevel:  { type: Number, default: 0 },   // at/below → "CRITICAL"
  costPrice:      { type: Number, default: 0 },   // per unit, most-recent-purchase-wins
  supplier:       { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
  isBatchTracked: { type: Boolean, default: false }, // optional batch/expiry tracking
  status:         { type: String, enum: ["Active","Inactive"], default: "Active" },
  notes:          { type: String, default: "" },
}, { timestamps: true });

inventoryItemSchema.index({ name: 1 }, { unique: true });

// Only populated for items with isBatchTracked = true. Purchases create a
// batch; deduction/wastage best-effort consume the oldest non-expired batch
// first (FIFO) so expiry alerts stay meaningful. currentStock on the parent
// InventoryItem remains the single authoritative "how much do we have" figure
// — batches exist for expiry-date granularity, not as a second source of truth.
const inventoryBatchSchema = new mongoose.Schema({
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
  batchNo:       { type: String, default: "" },
  quantity:      { type: Number, required: true, min: 0 }, // remaining in this batch
  costPrice:     { type: Number, default: 0 },
  expiryDate:    { type: Date, default: null },
  purchase:      { type: mongoose.Schema.Types.ObjectId, ref: "StockPurchase", default: null },
  receivedAt:    { type: Date, default: Date.now },
}, { timestamps: true });

inventoryBatchSchema.index({ inventoryItem: 1, expiryDate: 1 });

// One recipe per menu item. Quantities are per ONE unit of the menu item, in
// any unit convertible to the stock item's unit (utils/units.js: 100 ml of
// Milk stocked in l deducts 0.1 l) — scaled by the ordered qty when the
// order goes to the kitchen. CUSTOM ingredients aren't stocked: they only
// add their entered price to the making cost and are never deducted.
// unitCost/cost are a snapshot taken at save (utils/recipeCost.js); reads
// also return the live cost at today's stock prices.
const recipeIngredientSchema = new mongoose.Schema({
  sourceType:    { type: String, enum: INGREDIENT_SOURCES, default: "STOCK" },
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", default: null }, // STOCK only
  name:          { type: String, default: "", trim: true },
  quantity:      { type: Number, required: true, min: 0 },
  unit:          { type: String, enum: STOCK_UNITS, required: true },
  unitCost:      { type: Number, default: null }, // ₹ per `unit` at save time
  cost:          { type: Number, default: null }, // ₹ for `quantity` (CUSTOM: the entered price)
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  menuItem:    { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true, unique: true },
  ingredients: { type: [recipeIngredientSchema], default: [] },
  status:      { type: String, enum: ["Active","Inactive"], default: "Active" },
  totalCost:      { type: Number, default: null },  // making cost snapshot at save
  costIncomplete: { type: Boolean, default: false }, // some ingredient had no usable cost
  costedAt:       { type: Date, default: null },
}, { timestamps: true });

const stockPurchaseItemSchema = new mongoose.Schema({
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
  quantity:      { type: Number, required: true, min: 0.0001 },
  costPrice:     { type: Number, required: true, min: 0 },
  batchNo:       { type: String, default: "" },
  expiryDate:    { type: Date, default: null },
}, { _id: false });

const stockPurchaseSchema = new mongoose.Schema({
  supplier:       { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
  items:          { type: [stockPurchaseItemSchema], default: [] },
  totalCost:      { type: Number, required: true, min: 0 },
  invoiceNumber:  { type: String, default: "" },
  purchaseDate:   { type: Date, default: Date.now },
  notes:          { type: String, default: "" },
  createdBy:      { type: actorSchema, default: () => ({}) },
}, { timestamps: true });

// The single, append-only, unified audit trail for every stock movement of
// every kind — this IS the "Stock Movements" view. Never edited, only
// inserted. `balanceAfter` is a point-in-time snapshot so the ledger reads
// correctly even if later entries are added out of order.
const stockLedgerSchema = new mongoose.Schema({
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
  type:          { type: String, enum: LEDGER_TYPES, required: true },
  quantity:      { type: Number, required: true }, // signed: +in / -out
  balanceAfter:  { type: Number, required: true },
  relatedOrder:    { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  relatedPurchase: { type: mongoose.Schema.Types.ObjectId, ref: "StockPurchase", default: null },
  relatedWastage:  { type: mongoose.Schema.Types.ObjectId, ref: "WastageLog", default: null },
  reason:        { type: String, default: "" },
  createdBy:     { type: actorSchema, default: () => ({}) },
}, { timestamps: true });

stockLedgerSchema.index({ inventoryItem: 1, createdAt: -1 });
stockLedgerSchema.index({ type: 1, createdAt: -1 });
stockLedgerSchema.index({ relatedOrder: 1 });

const wastageLogSchema = new mongoose.Schema({
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
  quantity:      { type: Number, required: true, min: 0.0001 },
  reason:        { type: String, enum: WASTAGE_REASONS, default: "Other" },
  costImpact:    { type: Number, default: 0 }, // qty * item.costPrice at time of wastage
  notes:         { type: String, default: "" },
  recordedBy:    { type: actorSchema, default: () => ({}) },
  wastageDate:   { type: Date, default: Date.now },
}, { timestamps: true });

const invoiceSchema = new mongoose.Schema({
  orders:        [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  orderId:       String,
  user:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  isGuest:       { type: Boolean, default: false },
  orderType:     { type: String, default: "Dining" },
  subtotal:      { type: Number, required: true },
  tax:           { type: Number, required: true },
  serviceCharge: { type: Number, default: 0 },
  total:         { type: Number, required: true },
  items:         [{ name: String, price: Number, qty: Number }],
  tableNo:       { type: Number, default: null },
  status: {
    type: String,
    enum: ["pending","completed","paid","cancelled","refunded"],
    default: "pending",
  },
  paymentStatus:  { type: String, enum: ["PENDING_VERIFICATION","PAID","FAILED"], default: "PENDING_VERIFICATION" },
  paymentMethod:  { type: String, enum: ["Cash","Online"], default: "Cash" },
  generatedAt:    { type: Date, default: Date.now },
  notes:          { type: String, default: "" },
}, { timestamps: true });

// ── Table waitlist / walk-in queue (Phase 6) ────────────────────────────────
// A walk-in party who can't be seated immediately because every table that
// fits them is occupied. Entries stay WAITING (or NOTIFIED, once staff has
// flagged a suggested table for them) until a staff member explicitly seats
// or cancels them — seating is never automatic, see waitlistService.js.
const waitlistEntrySchema = new mongoose.Schema({
  guestName:   { type: String, required: true, trim: true },
  guestPhone:  { type: String, default: "" },
  partySize:   { type: Number, required: true, min: 1 },
  notes:       { type: String, default: "" },
  status:      { type: String, enum: ["WAITING","NOTIFIED","SEATED","CANCELLED"], default: "WAITING" },
  // Set only once seated — which table actually absorbed this party.
  tableNo:     { type: Number, default: null },
  notifiedAt:  { type: Date, default: null },
  seatedAt:    { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  createdBy:   { type: actorSchema, default: () => ({}) },
}, { timestamps: true });

waitlistEntrySchema.index({ status: 1, createdAt: 1 });

// ── Support tickets (Phase 3 — customer Help form) ─────────────────────────
const supportTicketSchema = new mongoose.Schema({
  name:    { type: String, default: "" },
  phone:   { type: String, default: "" },
  email:   { type: String, default: "" },
  subject: { type: String, default: "General" },
  message: { type: String, required: true },
  order:   { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  user:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  status:  { type: String, enum: ["OPEN","RESOLVED"], default: "OPEN" },
}, { timestamps: true });

// ── Employee attendance / presence / break tracking ────────────────────────
// One document per continuous duty session for one employee (admin/waiter/
// chef). `status` is the SESSION lifecycle (OPEN while on duty in any form,
// CLOSED once ended) — kept deliberately separate from `presenceStatus`
// (ONLINE/BREAK/OFFLINE, the UI-facing state) so the "one active session per
// employee" invariant below can be expressed as a simple partial unique
// index, exactly like TableSession's "one open session per table" above.
const attendanceBreakSchema = new mongoose.Schema({
  startedAt:       { type: Date, required: true },
  endedAt:         { type: Date, default: null },
  durationSeconds: { type: Number, default: 0 },
}, { _id: false });

const attendanceSessionSchema = new mongoose.Schema({
  employee:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role:         { type: String, enum: ["admin","waiter","chef"], required: true },
  // Denormalized snapshot at session-start time, same convenience pattern as
  // Order.waiterName — lets admin list/history views render without a join.
  employeeName: { type: String, default: "" },
  status:       { type: String, enum: ["OPEN","CLOSED"], default: "OPEN" },
  presenceStatus: { type: String, enum: ["ONLINE","BREAK","OFFLINE"], default: "ONLINE" },
  loginAt:      { type: Date, required: true, default: Date.now },
  logoutAt:     { type: Date, default: null },
  // Updated by the heartbeat socket event (utils/tenantKey.js rooms.staff
  // sockets) roughly every 30s while on duty. Never written on a
  // per-second cadence — see services/attendanceService.js.
  lastSeenAt:   { type: Date, default: Date.now },
  breaks:       { type: [attendanceBreakSchema], default: [] },
  totalBreakSeconds:   { type: Number, default: 0 },
  // Net working time = (logoutAt - loginAt) - totalBreakSeconds, computed
  // once at close time (services/attendanceService.js) and stored — never
  // recomputed live by a client clock.
  totalWorkingSeconds: { type: Number, default: 0 },
  // True when this session was closed by the server's heartbeat-timeout
  // sweep rather than an explicit "End Duty" action — kept for reporting
  // transparency, never hidden from the admin.
  autoClosed:   { type: Boolean, default: false },
}, { timestamps: true });

// Mirrors TableSessionSchema's exact pattern: only one OPEN session per
// employee at a time. "Start Duty" relies on this to detect/resume an
// already-active session instead of creating a duplicate.
attendanceSessionSchema.index(
  { employee: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" }, name: "one_open_session_per_employee" }
);
attendanceSessionSchema.index({ employee: 1, loginAt: -1 });
attendanceSessionSchema.index({ role: 1, status: 1 });
attendanceSessionSchema.index({ loginAt: -1 });

// ── Staff reviews (services/reviewService.js) ─────────────────────────────
// A customer's rating of a PAID order, split per kind: FOOD goes to the chef
// who cooked it, SERVICE to the waiter who took it (attributed server-side
// from the order's actor fields, never from the client). The unique
// {order, kind} index makes a re-submit a no-op instead of a duplicate.
const staffReviewSchema = new mongoose.Schema({
  order:        { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  orderNo:      { type: String, default: "" },
  kind:         { type: String, enum: ["FOOD","SERVICE"], required: true },
  employee:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  employeeRole: { type: String, default: "" },
  rating:       { type: Number, required: true, min: 1, max: 5 },
  tags:         { type: [String], default: [] },
  comment:      { type: String, default: "", maxlength: 500 },
  customerName: { type: String, default: "" },
  tableNo:      { type: Number, default: null },
  // Low rating or a negative tag → a complaint the owner marks as looked into.
  complaint:    { type: Boolean, default: false },
  lookedInto:   {
    type: new mongoose.Schema({ at: Date, by: actorSchema, note: { type: String, default: "" } }, { _id: false }),
    default: null,
  },
}, { timestamps: true });
staffReviewSchema.index({ order: 1, kind: 1 }, { unique: true });
staffReviewSchema.index({ employee: 1, createdAt: -1 });

// ── Staff leave (services/leaveService.js) ─────────────────────────────────
// PENDING → APPROVED | DECLINED, one atomic conditional update (never
// check-then-save), so two admins deciding at once can't both win.
const staffLeaveSchema = new mongoose.Schema({
  employee:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  from:        { type: Date, required: true },
  to:          { type: Date, required: true },
  days:        { type: Number, required: true, min: 1 },
  reason:      { type: String, default: "", maxlength: 300 },
  status:      { type: String, enum: ["PENDING","APPROVED","DECLINED","CANCELLED"], default: "PENDING" },
  paid:        { type: Boolean, default: false },
  source:      { type: String, enum: ["SELF","ADMIN"], default: "SELF" },
  requestedBy: { type: actorSchema, default: null },
  decidedBy:   { type: actorSchema, default: null },
  decidedAt:   { type: Date, default: null },
}, { timestamps: true });
staffLeaveSchema.index({ employee: 1, from: -1 });
staffLeaveSchema.index({ status: 1 });

// ── Staff pay ledger (services/payService.js) ──────────────────────────────
// ADVANCE rows (any number per month) and one SALARY row per person per
// month — enforced by a partial unique index, so "Mark paid" clicked twice
// (or by two admins) records the salary once.
const staffPaySchema = new mongoose.Schema({
  employee:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  month:     { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  type:      { type: String, enum: ["ADVANCE","SALARY"], required: true },
  amount:    { type: Number, required: true, min: 0 },
  method:    { type: String, enum: ["Cash","UPI","Bank"], default: "Cash" },
  note:      { type: String, default: "", maxlength: 200 },
  breakdown: { type: Object, default: null }, // SALARY: snapshot of the calculation
  by:        { type: actorSchema, default: null },
}, { timestamps: true });
staffPaySchema.index({ employee: 1, month: 1, type: 1 }, { unique: true, partialFilterExpression: { type: "SALARY" }, name: "one_salary_per_month" });
staffPaySchema.index({ employee: 1, createdAt: -1 });

// A sent-offer log — one row per admin broadcast (services/notificationService.js).
// recipientCount is a best-effort snapshot of how many customers were
// opted in at send time, not a delivery receipt — FCM topic sends don't
// report per-device delivery back to the sender.
const notificationLogSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  body:           { type: String, required: true, trim: true },
  // Optional coupon code shown with the offer (validated/normalized in
  // services/notificationService.js — uppercase A–Z, 0–9, "-" and "_").
  couponCode:     { type: String, default: "", trim: true },
  sentBy:         actorSchema,
  recipientCount: { type: Number, default: 0 },
  // ── Offer timing / scheduled send ────────────────────────────────────────
  // SCHEDULED → SENDING → SENT, or → FAILED / CANCELLED. Every change is an
  // atomic conditional findOneAndUpdate (runDueOffers claims SCHEDULED →
  // SENDING), so a scheduled offer is pushed at most once even with several
  // server instances. Customers only ever see SENT rows.
  status:    { type: String, enum: ["SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"], default: "SENDING" },
  startsAt:  { type: Date, default: null },  // null = send immediately
  expiresAt: { type: Date, default: null },  // null = never expires
  sendingAt: { type: Date, default: null },  // when the current send attempt was claimed
  sentAt:    { type: Date, default: null },
  error:     { type: String, default: "" },  // why a FAILED offer failed (admin-only)
}, { timestamps: true });
notificationLogSchema.index({ status: 1, startsAt: 1 });

// ── Coupons (services/couponService.js) ──────────────────────────────────────
// Admin-created discount codes. A coupon is offered to customers only while
// isActive and startsAt <= now <= endsAt — outside that window it is neither
// listed nor accepted when an order is placed. The discount itself is always
// computed server-side (utils/pricing.js), never taken from the client.
const couponSchema = new mongoose.Schema({
  code:           { type: String, required: true, unique: true, uppercase: true, trim: true },
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: "", trim: true },
  discountType:   { type: String, enum: ["PERCENT", "FLAT"], required: true },
  discountValue:  { type: Number, required: true },   // % (1–100) or ₹
  maxDiscount:    { type: Number, default: null },    // ₹ cap for PERCENT; null = no cap
  minOrderAmount: { type: Number, default: 0 },       // ₹, on the item subtotal
  startsAt:       { type: Date, required: true },
  endsAt:         { type: Date, required: true },
  isActive:       { type: Boolean, default: true },   // admin pause switch
  // Who may see/use it: ALL, REGISTERED (logged-in customers only) or GUEST
  // (not logged in only). Enforced when listing AND when an order is placed.
  audience:       { type: String, enum: ["ALL", "REGISTERED", "GUEST"], default: "ALL" },
  // The offer push announcing it to registered customers, if the admin chose
  // to send one (NotificationLog — scheduled for startsAt, expires at endsAt).
  announce:       { type: Boolean, default: false },  // admin wants it pushed (kept across pause/resume)
  notification:   { type: mongoose.Schema.Types.ObjectId, ref: "NotificationLog", default: null },
  createdBy:      actorSchema,
}, { timestamps: true });
couponSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

// ── Call waiter (customer → the order's waiter) ─────────────────────────────
// services/waiterCallService.js. Attempt 1 rings the waiter who took/accepted
// the order (if on duty) for 3 min; attempt 2 rings every on-duty waiter for
// 2 min; after that the customer is shown the restaurant's phone number.
// `active` is true only while OPEN/ACKNOWLEDGED — the partial unique index on
// { order, active } guarantees at most one live call per order, so a double
// tap or two tabs can never ring twice.
const waiterCallSchema = new mongoose.Schema({
  order:          { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  orderNumber:    { type: String, default: "" },   // order.orderId, for display
  tableNo:        { type: Number, default: null },
  customerName:   { type: String, default: "" },
  attempt:        { type: Number, enum: [1, 2], required: true },
  targets:        [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // waiters rung
  status:         { type: String, enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED", "EXPIRED", "CANCELLED"], default: "OPEN" },
  active:         { type: Boolean, default: true },
  expiresAt:      { type: Date, required: true },
  acknowledgedBy: actorSchema,
  acknowledgedAt: { type: Date, default: null },
  resolvedBy:     actorSchema,
  resolvedAt:     { type: Date, default: null },
}, { timestamps: true });
waiterCallSchema.index({ order: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
waiterCallSchema.index({ targets: 1, active: 1 });

// ── Main function: returns all models bound to a specific DB connection ────────
export function getModels(conn) {
  if (!conn) throw new Error("No DB connection provided to getModels()");
  return {
    User:              conn.models.User              || conn.model("User",              userSchema),
    RestaurantProfile: conn.models.RestaurantProfile || conn.model("RestaurantProfile", restaurantProfileSchema),
    Category:          conn.models.Category          || conn.model("Category",          categorySchema),
    Chef:              conn.models.Chef              || conn.model("Chef",              chefSchema),
    MenuItem:          conn.models.MenuItem          || conn.model("MenuItem",          menuItemSchema),
    Order:             conn.models.Order             || conn.model("Order",             orderSchema),
    Counter:           conn.models.Counter           || conn.model("Counter",           counterSchema),
    Table:             conn.models.Table             || conn.model("Table",             tableSchema),
    TableSession:      conn.models.TableSession      || conn.model("TableSession",      tableSessionSchema),
    KOTJob:            conn.models.KOTJob            || conn.model("KOTJob",            kotJobSchema),
    BillPrintJob:      conn.models.BillPrintJob      || conn.model("BillPrintJob",      billPrintJobSchema),
    PrinterDevice:     conn.models.PrinterDevice     || conn.model("PrinterDevice",     printerDeviceSchema),
    Invoice:           conn.models.Invoice           || conn.model("Invoice",           invoiceSchema),
    SupportTicket:     conn.models.SupportTicket     || conn.model("SupportTicket",     supportTicketSchema),
    WaitlistEntry:     conn.models.WaitlistEntry     || conn.model("WaitlistEntry",     waitlistEntrySchema),
    NotificationLog:   conn.models.NotificationLog   || conn.model("NotificationLog",   notificationLogSchema),
    AttendanceSession: conn.models.AttendanceSession || conn.model("AttendanceSession", attendanceSessionSchema),
    StaffReview:       conn.models.StaffReview       || conn.model("StaffReview",       staffReviewSchema),
    StaffLeave:        conn.models.StaffLeave        || conn.model("StaffLeave",        staffLeaveSchema),
    StaffPay:          conn.models.StaffPay          || conn.model("StaffPay",          staffPaySchema),

    // ── Inventory (Phase 2) ────────────────────────────────────────────────
    Supplier:          conn.models.Supplier          || conn.model("Supplier",          supplierSchema),
    InventoryItem:     conn.models.InventoryItem     || conn.model("InventoryItem",     inventoryItemSchema),
    InventoryBatch:    conn.models.InventoryBatch    || conn.model("InventoryBatch",    inventoryBatchSchema),
    Recipe:            conn.models.Recipe            || conn.model("Recipe",            recipeSchema),
    StockPurchase:      conn.models.StockPurchase     || conn.model("StockPurchase",     stockPurchaseSchema),
    StockLedger:        conn.models.StockLedger       || conn.model("StockLedger",       stockLedgerSchema),
    WastageLog:          conn.models.WastageLog         || conn.model("WastageLog",         wastageLogSchema),
    WaiterCall:          conn.models.WaiterCall         || conn.model("WaiterCall",         waiterCallSchema),
    Coupon:              conn.models.Coupon             || conn.model("Coupon",             couponSchema),
  };
}
