// utils/supplierInput.js
// ─────────────────────────────────────────────────────────────────────────────
// INV-11..14 — the only fields a supplier record takes from a request
// (it used to accept req.body wholesale). Pure; throws 400-style errors.
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import { AUTO_ORDER_PREFERENCES, CREDIT_PREFERENCES } from "./inventoryConstants.js";

const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
const text = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
// India GSTIN: 2 digits + 10 PAN characters + entity + Z + checksum.
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param partial  true for an update (only the fields sent are returned)
 * @returns a clean object for Supplier.create / $set
 */
export const cleanSupplierInput = (body = {}, { partial = false } = {}) => {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has("name")) {
    const name = text(body.name, 80);
    if (!name) throw bad("Supplier name is required");
    out.name = name;
  }
  if (has("phone")) {
    const phone = String(body.phone ?? "").replace(/[^\d+]/g, "");
    if (phone && !/^\+?\d{10,13}$/.test(phone)) throw bad("Phone number should be 10 digits");
    out.phone = phone;
  }
  if (has("email")) {
    const email = text(body.email, 120).toLowerCase();
    if (email && !EMAIL.test(email)) throw bad("That email address doesn't look right");
    out.email = email;
  }
  if (has("gstNumber")) {
    const gst = String(body.gstNumber ?? "").toUpperCase().replace(/\s+/g, "");
    if (gst && !GSTIN.test(gst)) throw bad("GST number should be 15 characters, e.g. 19ABCDE1234F1Z5");
    out.gstNumber = gst;
  }
  for (const k of ["address", "notes"]) if (has(k)) out[k] = text(body[k], 300);
  if (has("status")) {
    if (!["Active", "Inactive"].includes(body.status)) throw bad("status must be Active or Inactive");
    out.status = body.status;
  }

  // INV-12 — supplied items: stock items by id, or names not stocked yet.
  if (has("suppliedItems")) {
    if (!Array.isArray(body.suppliedItems)) throw bad("suppliedItems must be a list");
    const seen = new Set();
    out.suppliedItems = [];
    for (const it of body.suppliedItems.slice(0, 200)) {
      const id = it?.inventoryItem ? String(it.inventoryItem) : "";
      if (id && !mongoose.isValidObjectId(id)) throw bad("Unknown stock item in supplied items");
      const name = text(it?.name, 80);
      if (!id && !name) continue;
      const key = id || `n:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.suppliedItems.push({ inventoryItem: id || null, name });
    }
  }

  // INV-13 / INV-14
  if (has("autoOrderPreference")) {
    if (!AUTO_ORDER_PREFERENCES.includes(body.autoOrderPreference)) throw bad("Pick how re-orders should go: Ask me first, One tap or Send link");
    out.autoOrderPreference = body.autoOrderPreference;
  }
  if (has("creditPreference")) {
    if (!CREDIT_PREFERENCES.includes(body.creditPreference)) throw bad("Pick the supplier's payment terms");
    out.creditPreference = body.creditPreference;
  }
  if (has("creditTerms")) out.creditTerms = text(body.creditTerms, 200);
  return out;
};

/** INV-14: what Record Purchase pre-selects for this supplier. */
export const defaultPaymentTypeFor = (supplier) => (supplier?.creditPreference === "GIVES_CREDIT" ? "CREDIT" : "PAID");
