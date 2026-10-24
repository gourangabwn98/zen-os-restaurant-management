// Companion collections only. Register lazily on the existing request's DB;
// never create collections/indexes from normal requests or application boot.
import mongoose from "mongoose";

export const V3_STORAGE_VERSION = 1;
export const AUTO_ORDER_MODES = ["OFF", "ASK_FIRST", "ONE_TAP"];
export const COST_TREATMENTS = ["OPERATING_EXPENSE", "OTHER_INCOME", "DRAWING", "CAPITAL", "DEPRECIATION", "AMORTISATION", "INTEREST", "TAX", "SETTLEMENT", "ADVANCE"];
const { Schema } = mongoose;
const options = { timestamps: true, strict: "throw", autoCreate: false, autoIndex: false };
const ref = (model, required = false) => ({ type: Schema.Types.ObjectId, ref: model, required, default: required ? undefined : null });
const text = (max = 200) => ({ type: String, trim: true, maxlength: max, default: "" });
const integer = (defaultValue = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => ({
  type: Number, default: defaultValue, min, max, validate: { validator: Number.isSafeInteger, message: "Must be a safe integer" },
});
const money = (required = false) => ({ ...integer(required ? undefined : 0), required });
const decimal = (nullable = false) => ({
  type: String, default: nullable ? null : "0", maxlength: 24,
  validate: { validator: (v) => (nullable && v == null) || /^\d{1,12}(?:\.\d{1,6})?$/.test(v), message: "Invalid non-negative decimal quantity/rate" },
});
const localDate = (required = false) => ({
  type: String, required, default: required ? undefined : null,
  validate: { validator: (v) => v == null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v), message: "Invalid calendar date" },
});
const actor = new Schema({ user: ref("User", true), name: text(120), role: text(30) }, { _id: false, strict: "throw" });
const requiredActor = { type: actor, required: true };
const requestKey = { type: String, required: true, minlength: 8, maxlength: 128, match: /^[A-Za-z0-9:_-]+$/ };
const sourceRef = new Schema({ model: { type: String, required: true, maxlength: 80 }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false, strict: "throw" });
const unique = (schema, key, name) => schema.index(key, { unique: true, name });

const settings = new Schema({
  _id: { type: String, default: "default", enum: ["default"] },
  enabled: { type: Boolean, default: false },
  storageVersion: integer(0),
  foodCostTargetBps: integer(3500, 1, 10000),
  countIntervalDays: integer(4, 1, 365),
  autoOrderMode: { type: String, enum: AUTO_ORDER_MODES, default: "OFF" },
  revision: integer(0), updatedBy: { type: actor, default: null },
}, options);
const itemConfig = new Schema({
  inventoryItem: ref("InventoryItem", true), usualStockQty: decimal(true),
  costClass: { type: String, enum: ["FOOD", "PACKAGING", "NON_FOOD", "UNKNOWN"], default: "UNKNOWN" },
  updatedBy: { type: actor, default: null },
}, options);
unique(itemConfig, { inventoryItem: 1 }, "v3_item_config_unique");
const supplierConfig = new Schema({
  supplier: ref("Supplier", true),
  autoOrderMode: { type: String, enum: [...AUTO_ORDER_MODES, null], default: null },
  creditFrequency: { type: String, enum: ["YES", "SOMETIMES", "NO", "UNKNOWN"], default: "UNKNOWN" },
  groups: { type: [{ type: String, maxlength: 80 }], default: [] },
  updatedBy: { type: actor, default: null },
}, options);
unique(supplierConfig, { supplier: 1 }, "v3_supplier_config_unique");

const financialEntry = new Schema({
  requestKey, treatment: { type: String, enum: COST_TREATMENTS, required: true },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  amountPaise: money(true), effectiveDate: localDate(true), occurredAt: { type: Date, required: true },
  paymentSource: { type: String, enum: ["CASH_DRAWER", "BANK_UPI", "OWNER_POCKET", "UNPAID", "NONE"], required: true },
  source: { type: String, enum: ["MANUAL", "BILL_PHOTO", "REPEATS", "AUTO"], default: "MANUAL" },
  supplier: ref("Supplier"), attachmentUrl: text(2048), notes: text(1000),
  occurrenceKey: { type: String, maxlength: 160, default: null },
  reversalOf: ref("InventoryFinancialEntry"),
  createdBy: requiredActor, calculationVersion: integer(1, 1),
}, options);
unique(financialEntry, { requestKey: 1 }, "v3_financial_request_unique");
financialEntry.index({ effectiveDate: -1, _id: -1 }, { name: "v3_financial_date" });
financialEntry.index({ occurrenceKey: 1 }, { unique: true, partialFilterExpression: { occurrenceKey: { $type: "string" } }, name: "v3_financial_occurrence_unique" });
financialEntry.index({ reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $type: "objectId" } }, name: "v3_financial_reversal_unique" });

const recurringRule = new Schema({
  ruleKey: { type: String, required: true, maxlength: 128 }, revision: integer(1, 1),
  treatment: { type: String, enum: ["OPERATING_EXPENSE", "OTHER_INCOME", "INTEREST", "TAX"], required: true },
  category: { type: String, required: true, maxlength: 80 }, amountPaise: money(true),
  frequency: { type: String, enum: ["MONTHLY", "YEARLY"], default: "MONTHLY" },
  day: integer(1, 1, 28), month: integer(1, 1, 12),
  effectiveFrom: localDate(true), effectiveTo: localDate(), enabled: { type: Boolean, default: false },
  createdBy: requiredActor,
}, options);
unique(recurringRule, { ruleKey: 1, revision: 1 }, "v3_recurring_revision_unique");
recurringRule.pre("validate", function () {
  if (this.effectiveTo && this.effectiveTo < this.effectiveFrom) this.invalidate("effectiveTo", "End precedes start");
});
const costSchedule = new Schema({
  financialEntry: ref("InventoryFinancialEntry", true),
  treatment: { type: String, enum: ["OPERATING_EXPENSE", "DEPRECIATION", "AMORTISATION"], required: true },
  basisPaise: money(true), residualPaise: money(), periods: integer(undefined, 1, 1200),
  startsOn: localDate(true), createdBy: requiredActor,
}, options);
costSchedule.path("periods").required(true);
costSchedule.pre("validate", function () {
  if (this.residualPaise > this.basisPaise) this.invalidate("residualPaise", "Residual exceeds basis");
});
unique(costSchedule, { financialEntry: 1 }, "v3_schedule_entry_unique");

const countLine = new Schema({
  inventoryItem: ref("InventoryItem", true), unit: { type: String, required: true, enum: ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"] },
  countedQty: decimal(), expectedQty: decimal(), unitRateRupees: decimal(true),
  observedAt: { type: Date, required: true }, stockUpdatedAt: { type: Date, default: null },
  ledgerWatermark: ref("StockLedger"), relatedLedger: ref("StockLedger"),
}, { _id: false, strict: "throw" });
const countSession = new Schema({
  requestKey, status: { type: String, enum: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"], default: "DRAFT" },
  scope: { type: String, enum: ["SELECTED_ITEMS", "FULL"], default: "SELECTED_ITEMS" },
  lines: { type: [countLine], default: [], validate: { validator: (v) => v.length <= 1000 && new Set(v.map((l) => String(l.inventoryItem))).size === v.length, message: "Duplicate items or count too large" } },
  countedBy: requiredActor, submittedAt: { type: Date, default: null },
  approvedBy: { type: actor, default: null }, approvedAt: { type: Date, default: null },
  revision: integer(0), notes: text(1000),
}, options);
countSession.pre("validate", function () {
  if (this.status !== "DRAFT" && !this.lines.length) this.invalidate("lines", "A submitted count needs items");
  if (["SUBMITTED", "APPROVED"].includes(this.status) && !this.submittedAt) this.invalidate("submittedAt", "Submission time required");
  if (this.status === "APPROVED" && (!this.approvedBy || !this.approvedAt)) this.invalidate("approvedBy", "Approval actor and time required");
});
unique(countSession, { requestKey: 1 }, "v3_count_request_unique");
countSession.index({ status: 1, approvedAt: -1 }, { name: "v3_count_status_date" });

const bookExpectation = new Schema({
  key: { type: String, required: true, maxlength: 80 }, category: text(80),
  cadence: { type: String, enum: ["MONTHLY", "INTERVAL"], required: true },
  dueDay: integer(1, 1, 28), intervalDays: integer(5, 1, 365),
  enabled: { type: Boolean, default: false }, updatedBy: { type: actor, default: null },
}, options);
unique(bookExpectation, { key: 1 }, "v3_book_expectation_unique");
const bookConfirmation = new Schema({
  localDate: localDate(true), kind: { type: String, enum: ["NO_PURCHASE"], required: true }, confirmedBy: requiredActor,
}, options);
unique(bookConfirmation, { localDate: 1, kind: 1 }, "v3_book_confirmation_unique");
const lossClassification = new Schema({
  wastage: ref("WastageLog", true), kind: { type: String, enum: ["WASTE", "STAFF_FREE_MEAL"], required: true }, createdBy: requiredActor,
}, options);
unique(lossClassification, { wastage: 1 }, "v3_loss_classification_unique");
const operation = new Schema({
  requestKey, payloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  kind: { type: String, enum: ["PURCHASE", "OPENING_STOCK", "COUNT", "SETTLEMENT", "WASTAGE", "RECIPE", "FINANCIAL_ENTRY"], required: true },
  resultRef: { type: sourceRef, required: true }, createdBy: requiredActor,
}, options);
unique(operation, { requestKey: 1 }, "v3_operation_request_unique");
const audit = new Schema({
  operation: ref("InventoryV3Operation"), sourceRef: { type: sourceRef, required: true },
  event: { type: String, required: true, maxlength: 80 },
  amountPaise: money(), calculationVersion: integer(1, 1), createdBy: requiredActor,
  // Snapshot is audit evidence only, never accepted as executable query data.
  snapshot: { type: Map, of: String, default: () => ({}) },
}, options);
audit.index({ "sourceRef.model": 1, "sourceRef.id": 1, createdAt: -1 }, { name: "v3_audit_source" });

export const inventoryV3Schemas = Object.freeze({
  InventoryV3Settings: settings, InventoryItemV3Config: itemConfig, InventorySupplierV3Config: supplierConfig,
  InventoryFinancialEntry: financialEntry, InventoryRecurringRule: recurringRule, InventoryCostSchedule: costSchedule,
  InventoryCountSession: countSession, InventoryBookExpectation: bookExpectation, InventoryBookConfirmation: bookConfirmation,
  InventoryLossClassification: lossClassification, InventoryV3Operation: operation, InventoryV3Audit: audit,
});
export const getInventoryV3Models = (conn) => {
  if (!conn) throw new Error("An existing restaurant connection is required");
  return Object.fromEntries(Object.entries(inventoryV3Schemas).map(([name, schema]) => [name, conn.models[name] || conn.model(name, schema)]));
};
