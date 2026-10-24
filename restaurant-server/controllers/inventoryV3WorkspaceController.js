import cloudinary from "../config/cloudinary.js";
import { Readable } from "node:stream";
import { sniffFileType } from "../middleware/importUploadMiddleware.js";
import { workspaceData } from "../services/inventoryV3ReadService.js";
import * as ops from "../services/inventoryV3Operations.js";

export const respond = (fn) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json(await fn(req)); }
  catch (err) { res.status(err.statusCode || (err.name === "ValidationError" || err.name === "CastError" ? 400 : 500)).json({ message: err.statusCode || err.name === "ValidationError" ? err.message : "Could not complete inventory action. Refresh and try again." }); }
};
export const getWorkspace = respond(workspaceData);
export const saveItem = respond(ops.saveItem);
export const saveSupplier = respond(ops.saveSupplier);
export const previewPurchase = respond(ops.purchasePreview);
export const savePurchase = respond(ops.savePurchase);
export const saveFinancial = respond(ops.saveFinancial);
export const settle = respond(ops.settle);
export const submitCount = respond(ops.submitCount);
export const approveCount = respond(ops.approveCount);
export const saveWastage = respond(ops.saveWastage);
export const previewRecipe = respond(ops.recipePreview);
export const saveRecipe = respond(ops.saveRecipeV3);
export const confirmNothing = respond((req) => ops.transact(req, "CONFIRMATION", async ({ session, actor }) => {
  const day = ops.validDate(req.body.localDate), tz = await ops.profileTimezone(req.models);
  if (day >= ops.localDay(new Date(), tz)) throw ops.fail("Confirm a completed day");
  const doc = await req.v3.InventoryBookConfirmation.findOneAndUpdate({ localDate: day, kind: "NO_PURCHASE" }, { $setOnInsert: { confirmedBy: actor } }, { upsert: true, returnDocument: "after", session, runValidators: true });
  return { model: "InventoryBookConfirmation", id: doc._id };
}));
export const reverseEntry = respond((req) => ops.transact(req, "FINANCIAL_ENTRY", async ({ session, actor }) => {
  const old = await req.v3.InventoryFinancialEntry.findById(ops.id(req.params.id)).session(session).lean();
  if (!old || old.reversalOf) throw ops.fail("Entry cannot be reversed");
  const [doc] = await req.v3.InventoryFinancialEntry.create([{ requestKey: req.body.requestKey, treatment: old.treatment, category: old.category, amountPaise: old.amountPaise,
    effectiveDate: old.effectiveDate, occurredAt: old.occurredAt, paymentSource: old.paymentSource, reversalOf: old._id, notes: ops.cleanText(req.body.notes) || "Reversed in V3", createdBy: actor }], { session });
  return { model: "InventoryFinancialEntry", id: doc._id };
}));
export const setExpectation = respond(async (req) => {
  const days = Number(req.body.intervalDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw ops.fail("Interval must be 1–365 days");
  await req.v3.InventoryBookExpectation.findOneAndUpdate({ key: "gas" }, { $set: { category: "Gas / fuel", cadence: "INTERVAL", intervalDays: days, enabled: true, updatedBy: ops.v3Actor(req.user) } }, { upsert: true, runValidators: true });
  return { saved: true };
});
export const stopRecurring = respond(async (req) => {
  const day = ops.validDate(req.body.effectiveTo);
  const rule = await req.v3.InventoryRecurringRule.findById(ops.id(req.params.id));
  if (!rule) throw ops.fail("Recurring rule not found", 404);
  rule.effectiveTo = day; await rule.save();
  return { saved: true };
});
// Receipt storage only. This is never called by any AI preview.
export const uploadReceipt = respond(async (req) => {
  if (!req.file || !["image/jpeg", "image/png", "image/webp"].includes(sniffFileType(req.file.buffer))) throw ops.fail("Upload a JPG, PNG or WEBP bill photo");
  const url = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "inventory-v3-receipts", resource_type: "image" }, (err, result) => err ? reject(err) : resolve(result.secure_url));
    Readable.from(req.file.buffer).pipe(stream);
  });
  return { url };
});
