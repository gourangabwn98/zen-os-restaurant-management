// config/getModels.js
// ─────────────────────────────────────────────────────────────────────────────
// Returns Mongoose models bound to a specific restaurant's DB connection.
// Call this in every controller using: const { User, Order, ... } = getModels(req.db)
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import { ORDER_STATUSES, ORDER_SOURCES, ORDER_TYPES } from "../utils/orderStateMachine.js";
import { STOCK_UNITS, LEDGER_TYPES, WASTAGE_REASONS } from "../utils/inventoryConstants.js";

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
  isAdmin:    { type: Boolean, default: false },
  role:       { type: String, enum: ["admin","waiter","chef","customer"], default: "customer" },
  address:    { type: String, default: "" }, // employee address (Employee Management)
  waiterName: { type: String },
  // ── RBAC / staff account lifecycle (Phase 1) ──────────────────────────────
  // Lets an admin deactivate a waiter's access without deleting the account.
  status:     { type: String, enum: ["Active","Inactive"], default: "Active" },
  lastLoginAt:{ type: Date },
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
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name:  { type: String, required: true, unique: true, trim: true },
  image: { type: String, default: "" },
}, { timestamps: true });

const chefSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  phone:     { type: String, required: true, unique: true },
  status:    { type: String, enum: ["Active","Inactive"], default: "Active" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
}, { timestamps: true });

const menuItemSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  price:         { type: Number, required: true },
  originalPrice: { type: Number },
  description:   { type: String },
  category:      { type: String, required: true },
  categoryImage: { type: String, default: "" },
  tag:           { type: String, enum: ["Veg","Non Veg"], required: true },
  image:         { type: String, default: "" },
  isAvailable:   { type: Boolean, default: true },
  rating:        { type: Number, default: 4.0 },
}, { timestamps: true });

const orderItemSchema = new mongoose.Schema({
  menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true },
  name:     { type: String, required: true },
  price:    { type: Number, required: true },
  qty:      { type: Number, required: true, min: 1 },
  notes:    { type: String, default: "" },
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
  rating:         { type: Number, min: 1, max: 5 },
  cancelDeadline: { type: Date },
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
  // on retry/double-click. A unique sparse index guarantees only the first
  // request actually creates a document; subsequent ones return the same order.
  idempotencyKey: { type: String, default: null },

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

orderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ tableSession: 1 });

orderSchema.pre("save", async function () {
  if (!this.orderId) {
    const count = await this.constructor.countDocuments();
    this.orderId = `ORD${String(count + 1).padStart(5, "0")}`;
  }
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
  items:      [{ name: String, qty: Number, notes: String }],
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

// One recipe per menu item. Ingredient quantities are in the SAME unit as
// the referenced InventoryItem (see utils/inventoryConstants.js comment) —
// scaled by the ordered item's qty at confirmation time.
const recipeIngredientSchema = new mongoose.Schema({
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
  quantity:      { type: Number, required: true, min: 0 },
  unit:          { type: String, enum: STOCK_UNITS, required: true },
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  menuItem:    { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true, unique: true },
  ingredients: { type: [recipeIngredientSchema], default: [] },
  status:      { type: String, enum: ["Active","Inactive"], default: "Active" },
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
    Table:             conn.models.Table             || conn.model("Table",             tableSchema),
    TableSession:      conn.models.TableSession      || conn.model("TableSession",      tableSessionSchema),
    KOTJob:            conn.models.KOTJob            || conn.model("KOTJob",            kotJobSchema),
    BillPrintJob:      conn.models.BillPrintJob      || conn.model("BillPrintJob",      billPrintJobSchema),
    PrinterDevice:     conn.models.PrinterDevice     || conn.model("PrinterDevice",     printerDeviceSchema),
    Invoice:           conn.models.Invoice           || conn.model("Invoice",           invoiceSchema),
    SupportTicket:     conn.models.SupportTicket     || conn.model("SupportTicket",     supportTicketSchema),

    // ── Inventory (Phase 2) ────────────────────────────────────────────────
    Supplier:          conn.models.Supplier          || conn.model("Supplier",          supplierSchema),
    InventoryItem:     conn.models.InventoryItem     || conn.model("InventoryItem",     inventoryItemSchema),
    InventoryBatch:    conn.models.InventoryBatch    || conn.model("InventoryBatch",    inventoryBatchSchema),
    Recipe:            conn.models.Recipe            || conn.model("Recipe",            recipeSchema),
    StockPurchase:      conn.models.StockPurchase     || conn.model("StockPurchase",     stockPurchaseSchema),
    StockLedger:        conn.models.StockLedger       || conn.model("StockLedger",       stockLedgerSchema),
    WastageLog:          conn.models.WastageLog         || conn.model("WastageLog",         wastageLogSchema),
  };
}
