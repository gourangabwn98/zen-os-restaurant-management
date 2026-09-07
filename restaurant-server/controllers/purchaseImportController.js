// controllers/purchaseImportController.js
// ─────────────────────────────────────────────────────────────────────────────
// Inventory → Import Purchase. Two endpoints:
//   POST /admin/inventory/import/extract  — file in, candidate rows out.
//                                            NEVER writes to the database.
//   POST /admin/inventory/import/confirm  — Admin-approved rows in; creates
//                                            any brand-new InventoryItems and
//                                            then calls the EXISTING
//                                            recordPurchase() (services/
//                                            inventoryService.js) inside one
//                                            transaction — the same function
//                                            the manual "Record purchase"
//                                            form already uses. No second
//                                            inventory-write path is created.
// ─────────────────────────────────────────────────────────────────────────────
import { buildActor } from "../services/orderService.js";
import { recordPurchase } from "../services/inventoryService.js";
import { STOCK_UNITS } from "../utils/inventoryConstants.js";
import { extractDocumentText } from "../utils/purchaseImportExtract.js";
import { parsePurchaseLineItems, extractDocumentMeta } from "../utils/purchaseImportParser.js";
import { sniffFileType } from "../middleware/importUploadMiddleware.js";

// OCR on a slow/shared-CPU host can run long enough to hit the hosting
// platform's own proxy timeout (Render's is commonly ~30s) — when that
// fires, the connection is killed before this server ever gets to send its
// own JSON error, so the browser just sees a bare 500/502 with no message.
// Racing a slightly shorter timeout here means the Admin always gets an
// honest, actionable response instead.
const EXTRACT_TIMEOUT_MS = 25_000;
const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(message), { statusCode: 504 })), ms)),
  ]);

// ═══════════════════════════ POST /import/extract ═══════════════════════════
export const extractPurchaseDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    // Never trust the client-declared mimetype alone — sniff the real bytes.
    const sniffed = sniffFileType(req.file.buffer);
    if (!sniffed) {
      return res.status(400).json({ message: "This file doesn't look like a valid PDF, JPG, PNG or WEBP — it may be corrupted or renamed" });
    }

    let extraction;
    try {
      extraction = await withTimeout(
        extractDocumentText(req.file.buffer, sniffed),
        EXTRACT_TIMEOUT_MS,
        "This is taking too long to process (the server may be under load). Try a smaller or clearer file, or add these items manually.",
      );
    } catch (err) {
      const offline = /fetch|network|ENOTFOUND|ECONNREFUSED/i.test(err.message || "");
      return res.status(err.statusCode || 502).json({
        message: offline
          ? "OCR is unavailable right now (couldn't reach the language-data service). Try again shortly, or enter these items manually."
          : err.statusCode === 504
            ? err.message
            : `Could not read this document: ${err.message}`,
      });
    }

    if (!extraction.rawText || extraction.rawText.trim().length === 0) {
      return res.status(422).json({
        message: extraction.sourceType === "SCANNED_PDF" || extraction.sourceType === "IMAGE"
          ? "No readable text was found in this file — the image may be too low-quality to scan. You can still add these items manually."
          : "This PDF has no extractable text and no pages to scan — it may be empty or corrupted.",
        sourceType: extraction.sourceType,
      });
    }

    const meta = extractDocumentMeta(extraction.rawText);
    const parsedRows = parsePurchaseLineItems(extraction.rawText);

    if (parsedRows.length === 0) {
      return res.status(422).json({
        message: "We couldn't identify any item lines in this document. You can still add items manually.",
        sourceType: extraction.sourceType,
        ...meta,
        items: [],
      });
    }

    // Match each candidate line against existing inventory by name
    // (case-insensitive). A match means "add stock to this item" — an
    // unmatched name means "this would be a new inventory item", exactly the
    // same two outcomes the manual workflow already has (Add stock item vs.
    // Record purchase against an existing one). Nothing is created yet.
    const { InventoryItem } = req.models;
    const existingItems = await InventoryItem.find({ status: "Active" }).select("name unit category").lean();
    const byLowerName = new Map(existingItems.map((i) => [i.name.trim().toLowerCase(), i]));

    const items = parsedRows.map((row, index) => {
      const match = row.name ? byLowerName.get(row.name.trim().toLowerCase()) : null;
      const reviewReasons = [...row.reviewReasons];
      let unit = row.unit;

      if (match) {
        if (row.unit && row.unit !== match.unit) {
          reviewReasons.push(`Document said "${row.unit}" but "${match.name}" is tracked in "${match.unit}" — using ${match.unit}`);
        }
        unit = match.unit; // existing item's unit is authoritative
      }

      return {
        id: index,
        rawLine: row.rawLine,
        name: row.name,
        category: match?.category || row.category || "",
        quantity: row.quantity,
        unit,
        costPrice: row.costPrice,
        batchNo: row.batchNo,
        expiryDate: row.expiryDate,
        isNewItem: !match,
        matchedInventoryItemId: match?._id || null,
        needsReview: reviewReasons.length > 0 || !row.name,
        reviewReasons: row.name ? reviewReasons : [...reviewReasons, "Could not identify an item name"],
      };
    });

    res.json({
      sourceType: extraction.sourceType,
      pageCount: extraction.pageCount,
      warning: extraction.warning,
      ...meta,
      items,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message || "Extraction failed" });
  }
};

// ═══════════════════════════ POST /import/confirm ═══════════════════════════
const validateRow = (row, i) => {
  const errors = [];
  if (!row.isNewItem && !row.inventoryItemId) errors.push("Missing item link");
  if (row.isNewItem && (!row.name || !row.name.trim())) errors.push("Item name is required");
  if (!row.unit || !STOCK_UNITS.includes(row.unit)) errors.push("Unit is required");
  if (!(Number(row.quantity) > 0)) errors.push("Quantity must be greater than 0");
  if (!(Number(row.costPrice) >= 0)) errors.push("Cost must be 0 or more");
  return errors.length ? { index: i, name: row.name || `Row ${i + 1}`, errors } : null;
};

export const confirmPurchaseImport = async (req, res) => {
  const { supplier, invoiceNumber, purchaseDate, notes, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "No items to import" });
  }

  // Validate every row BEFORE opening a transaction — an invalid payload
  // should never get partway through creating records.
  const rowErrors = items.map(validateRow).filter(Boolean);
  if (rowErrors.length) {
    return res.status(400).json({ message: "Some rows need to be fixed before importing", rowErrors });
  }

  const session = await req.db.startSession();
  try {
    const { InventoryItem } = req.models;
    const actor = buildActor(req.user);
    let purchase, itemsCreated = 0;

    await session.withTransaction(async () => {
      const resolvedItems = [];

      for (const row of items) {
        let inventoryItemId = row.inventoryItemId;

        if (row.isNewItem) {
          const [created] = await InventoryItem.create(
            [{
              name: row.name.trim(),
              unit: row.unit,
              category: row.category || "",
              costPrice: Number(row.costPrice) || 0,
              currentStock: 0, // stock is applied below via the same purchase path as manual entry
              supplier: supplier || null,
            }],
            { session },
          );
          inventoryItemId = created._id;
          itemsCreated++;
        } else {
          const existing = await InventoryItem.findById(inventoryItemId).session(session);
          if (!existing) {
            const err = new Error(`"${row.name}" no longer exists in inventory — remove this row and retry`);
            err.statusCode = 409;
            throw err;
          }
          if (existing.unit !== row.unit) {
            const err = new Error(`"${existing.name}" is tracked in "${existing.unit}", not "${row.unit}"`);
            err.statusCode = 409;
            throw err;
          }
        }

        resolvedItems.push({
          inventoryItem: inventoryItemId,
          quantity: Number(row.quantity),
          costPrice: Number(row.costPrice),
          batchNo: row.batchNo || "",
          expiryDate: row.expiryDate || null,
        });
      }

      // The existing, unmodified purchase-recording path — same one the
      // manual "Record purchase" form calls.
      purchase = await recordPurchase({
        models: req.models,
        body: {
          supplier: supplier || null,
          items: resolvedItems,
          invoiceNumber: invoiceNumber || "",
          purchaseDate: purchaseDate || new Date(),
          notes: notes ? `${notes} (imported)` : "Imported from purchase document",
        },
        actor,
        session,
      });
    });

    res.status(201).json({
      purchase,
      itemsImported: items.length,
      itemsCreated,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "One of these items was created moments ago under the same name — refresh and try again" });
    }
    res.status(err.statusCode || 400).json({ message: err.message || "Import failed" });
  } finally {
    session.endSession();
  }
};
