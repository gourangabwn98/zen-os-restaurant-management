// src/pages/admin/inventory/ImportPurchaseModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Inventory → Import Purchase. Upload a purchase invoice/list (PDF or image),
// extract candidate line items server-side, and let the Admin review/edit
// every row before anything is written to Inventory.
//
// This is a second ENTRY POINT into the exact same backend the manual
// "Record purchase" form (PurchasesTab.jsx) already uses — POST
// /admin/inventory/import/confirm creates any brand-new InventoryItems and
// then calls the same recordPurchase() service the manual form calls.
// Nothing here talks to a database directly, and manual entry (Add stock
// item / Record purchase) is untouched.
//
// Steps: upload → extracting → review (edit/remove rows) → confirming.
// Zen OS visual language throughout — invUI.jsx/invKit.js components + .zc-*
// tokens, same as the rest of the Inventory tabs.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  extractPurchaseImport, confirmPurchaseImport, getSuppliers,
} from "../../../services/inventoryService.js";
import { Modal, Loading } from "./invUI.jsx";
import { inp, label as labelStyle } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";

const STOCK_UNITS = ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"];
const ACCEPTED_MIME = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
};
const ACCEPTED_EXT = ".pdf,.jpg,.jpeg,.png,.webp";
const MAX_FILE_MB = 15;

const fmtBytes = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

// One row's validity — recomputed live as the Admin edits, not just at
// extraction time (fixing a missing field should clear "Needs review").
function rowIssues(row) {
  const issues = [];
  if (row.isNewItem && !row.name.trim()) issues.push("Item name is required");
  if (!row.unit) issues.push("Unit is required");
  if (!(Number(row.quantity) > 0)) issues.push("Quantity must be greater than 0");
  if (row.costPrice === "" || row.costPrice == null || !(Number(row.costPrice) >= 0)) issues.push("Cost must be 0 or more");
  return issues;
}

export default function ImportPurchaseModal({ inventoryItems, onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload | extracting | review
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  const [extractError, setExtractError] = useState("");
  const [sourceInfo, setSourceInfo] = useState(null); // { sourceType, warning }
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // ── file selection ─────────────────────────────────────────────────────
  const validateFile = (f) => {
    if (!f) return "";
    if (!ACCEPTED_MIME[f.type]) {
      return "Unsupported file type — please upload a PDF, JPG, PNG or WEBP file";
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      return `File is too large — the maximum is ${MAX_FILE_MB}MB`;
    }
    return "";
  };

  const pickFile = (f) => {
    if (!f) return;
    const err = validateFile(f);
    setFileError(err);
    setFile(err ? null : f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  // ── extraction ──────────────────────────────────────────────────────────
  const handleContinue = async () => {
    if (!file) return;
    setStep("extracting");
    setExtractError("");
    try {
      if (!suppliers) {
        getSuppliers().then((r) => setSuppliers(r.data?.suppliers || [])).catch(() => setSuppliers([]));
      }
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await extractPurchaseImport(fd);

      const rows = (data.items || []).map((row) => ({
        ...row,
        localId: `row-${row.id}`,
        category: row.category || "",
        quantity: row.quantity ?? "",
        costPrice: row.costPrice ?? "",
        batchNo: row.batchNo || "",
        expiryDate: row.expiryDate || "",
      }));

      setItems(rows);
      setSourceInfo({ sourceType: data.sourceType, warning: data.warning });
      setInvoiceNumber(data.invoiceNumberGuess || "");
      setPurchaseDate(data.purchaseDateGuess || "");
      setStep("review");
    } catch (err) {
      // Covers unreadable/corrupted files AND "no items found" (the backend
      // returns 422 for a document it could read but couldn't find any item
      // lines in) — both are errors, not an empty-but-valid review screen.
      setExtractError(err.response?.data?.message || "Could not process this file. Please try again.");
      setStep("upload");
    }
  };

  // ── row editing ─────────────────────────────────────────────────────────
  const updateRow = useCallback((localId, patch) => {
    setItems((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }, []);
  const removeRow = (localId) => setItems((prev) => prev.filter((r) => r.localId !== localId));

  const linkToItem = (localId, inventoryItemId) => {
    if (!inventoryItemId) {
      updateRow(localId, { isNewItem: true, matchedInventoryItemId: null, unit: null, category: "" });
      return;
    }
    const match = inventoryItems.find((i) => i._id === inventoryItemId);
    updateRow(localId, {
      isNewItem: false,
      matchedInventoryItemId: inventoryItemId,
      unit: match?.unit || null,
      category: match?.category || "",
    });
  };

  // ── confirm ─────────────────────────────────────────────────────────────
  const validRows = items.map((r) => ({ row: r, issues: rowIssues(r) }));
  const readyCount = validRows.filter((v) => v.issues.length === 0).length;
  const hasBlockingIssues = items.length > 0 && validRows.some((v) => v.issues.length > 0);
  const canConfirm = items.length > 0 && !hasBlockingIssues;

  const handleDone = async () => {
    if (!canConfirm || saving) return;
    if (!window.confirm(`Add ${readyCount} item${readyCount === 1 ? "" : "s"} to inventory?`)) return;
    setSaving(true);
    try {
      const { data } = await confirmPurchaseImport({
        supplier: supplier || null,
        invoiceNumber,
        purchaseDate: purchaseDate || null,
        notes,
        items: items.map((r) => ({
          isNewItem: r.isNewItem,
          inventoryItemId: r.matchedInventoryItemId,
          name: r.name,
          category: r.category,
          unit: r.unit,
          quantity: Number(r.quantity),
          costPrice: Number(r.costPrice),
          batchNo: r.batchNo,
          expiryDate: r.expiryDate || null,
        })),
      });
      const createdNote = data.itemsCreated > 0 ? ` (${data.itemsCreated} new item${data.itemsCreated === 1 ? "" : "s"} created)` : "";
      toast.success(`${data.itemsImported} item${data.itemsImported === 1 ? "" : "s"} imported successfully${createdNote}`);
      onImported();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "Import failed — nothing was saved";
      const rowErrors = err.response?.data?.rowErrors;
      if (rowErrors?.length) {
        toast.error(`${msg}: ${rowErrors.map((r) => `${r.name} — ${r.errors.join(", ")}`).join("; ")}`, { duration: 6000 });
      } else {
        toast.error(msg);
      }
      // Preview stays exactly as the Admin left it — nothing is lost, they
      // can fix the flagged rows and try again.
    } finally {
      setSaving(false);
    }
  };

  const width = step === "review" ? 880 : 560;

  return (
    <Modal
      title={step === "review" ? "Review Purchase" : "Import Purchase List"}
      sub={step === "review"
        ? `${items.length} item${items.length === 1 ? "" : "s"} found`
        : "Upload a purchase invoice or item list. We'll extract the items so you can review them before adding them to inventory."}
      onClose={onClose}
      width={width}
      footer={step === "review" ? (
        <>
          <span style={{ marginRight: "auto", fontSize: 12.5, color: "var(--text-2)" }}>
            <b className="tnum" style={{ color: hasBlockingIssues ? "var(--wait-ink)" : "var(--ready-ink)" }}>{readyCount}</b> of {items.length} item{items.length === 1 ? "" : "s"} ready to import
          </span>
          <button type="button" className="zc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="zc-btn" onClick={() => { setStep("upload"); setItems([]); setFile(null); }}>Back</button>
          <button type="button" className="zc-btn pri" disabled={!canConfirm || saving} onClick={handleDone}>
            {saving ? "Importing…" : "Done — Add to Inventory"}
          </button>
        </>
      ) : step === "upload" ? (
        <>
          <button type="button" className="zc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="zc-btn pri" disabled={!file} onClick={handleContinue}>Continue</button>
        </>
      ) : null}
    >
      {step === "upload" && (
        <div>
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--violet)" : "var(--edge-hi)"}`,
                borderRadius: "var(--r-card)", padding: "36px 20px", textAlign: "center", cursor: "pointer",
                background: dragOver ? "var(--violet-faint)" : "var(--card-2)", transition: "var(--theme-transition)",
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
                Drag & drop a file here, or click to browse
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Accepted formats: PDF, JPG, JPEG, PNG, WEBP · up to {MAX_FILE_MB}MB</div>
              <input
                ref={fileInputRef} type="file" accept={ACCEPTED_EXT} style={{ display: "none" }}
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 12, padding: "13px 15px",
              borderRadius: "var(--r-ctl)", border: "1px solid var(--edge)", background: "var(--card-2)",
            }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", flex: "none",
                background: "var(--violet-weak)", color: "var(--accent-ink)", fontSize: 15, fontWeight: 700,
              }}>{ACCEPTED_MIME[file.type]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{ACCEPTED_MIME[file.type]} · {fmtBytes(file.size)}</div>
              </div>
              <button type="button" className="zc-btn ghost sm" onClick={() => { setFile(null); setFileError(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                Remove
              </button>
            </div>
          )}
          {fileError && <div style={{ marginTop: 10, fontSize: 12, color: "var(--stop-ink)" }}>{fileError}</div>}
          {extractError && (
            <div style={{ marginTop: 10, padding: "10px 13px", borderRadius: "var(--r-ctl)", background: "var(--stop-fill)", border: "1px solid var(--stop-line)", fontSize: 12, color: "var(--stop-ink)" }}>
              {extractError}
            </div>
          )}
        </div>
      )}

      {step === "extracting" && (
        <div style={{ padding: "10px 0" }}>
          <Loading rows={5} />
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-3)", marginTop: 4 }}>
            Reading “{file?.name}”… this can take a little longer for scanned documents.
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          {sourceInfo?.warning && (
            <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: "var(--r-ctl)", background: "var(--wait-fill)", border: "1px solid var(--wait-line)", fontSize: 11.5, color: "var(--wait-ink)" }}>
              {sourceInfo.warning}
            </div>
          )}
          {sourceInfo?.sourceType === "SCANNED_PDF" || sourceInfo?.sourceType === "IMAGE" ? (
            <div style={{ marginBottom: 12, fontSize: 11, color: "var(--text-3)" }}>Extracted via OCR — double-check quantities and costs below.</div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Supplier</label>
              <select style={inp} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">— none —</option>
                {(suppliers || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Invoice / bill number</label>
              <input style={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Purchase date</label>
              <input type="date" style={inp} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState icon="📄" title="No items to import" sub="Every extracted row has been removed. Go back to upload a different file, or close this and use Add stock item instead." />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="impp-row-head">
                <span>Item</span><span>Qty / Unit</span><span>Cost</span><span>Status</span><span />
              </div>
              {items.map((row) => (
                <ImportRow
                  key={row.localId}
                  row={row}
                  issues={rowIssues(row)}
                  editing={editingId === row.localId}
                  inventoryItems={inventoryItems}
                  onEdit={() => setEditingId(row.localId)}
                  onDone={() => setEditingId(null)}
                  onRemove={() => removeRow(row.localId)}
                  onChange={(patch) => updateRow(row.localId, patch)}
                  onLink={(id) => linkToItem(row.localId, id)}
                />
              ))}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes</label>
            <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── one extracted purchase line — display card + inline edit form ──────────
function ImportRow({ row, issues, editing, inventoryItems, onEdit, onDone, onRemove, onChange, onLink }) {
  const needsReview = issues.length > 0;
  const matched = !row.isNewItem && row.matchedInventoryItemId;

  return (
    <div className={`impp-item${needsReview ? " needs" : ""}`}>
      {!editing ? (
        <div className="impp-row">
          <div className="impp-name">
            <div style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 12.5 }}>
              {row.name || <span style={{ color: "var(--stop-ink)", fontStyle: "italic" }}>Unnamed item</span>}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              {matched ? "Existing item" : "New item"}{row.category ? ` · ${row.category}` : ""}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            {row.quantity !== "" ? row.quantity : "—"} {row.unit || ""}
          </div>
          <div className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
            {row.costPrice !== "" ? `₹${row.costPrice}` : "—"}
          </div>
          <div>
            {needsReview
              ? <span className="zc-tag wait" title={issues.join("; ")}><i />Needs review</span>
              : <span className="zc-tag ready"><i />Ready</span>}
          </div>
          <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
            <button type="button" className="zc-btn ghost sm" onClick={onEdit}>Edit</button>
            <button type="button" className="zc-btn danger sm" onClick={onRemove}>Remove</button>
          </div>
        </div>
      ) : (
        <div className="impp-edit">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Link to existing item</label>
              <select style={inp} value={row.isNewItem ? "" : row.matchedInventoryItemId || ""} onChange={(e) => onLink(e.target.value)}>
                <option value="">— Create new item —</option>
                {inventoryItems.map((i) => <option key={i._id} value={i._id}>{i.name} ({i.unit})</option>)}
              </select>
            </div>
            {row.isNewItem ? (
              <div>
                <label style={labelStyle}>Item name</label>
                <input style={inp} value={row.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Basmati Rice" />
              </div>
            ) : (
              <div>
                <label style={labelStyle}>Item name</label>
                <input style={{ ...inp, color: "var(--text-3)" }} value={row.name} disabled />
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Quantity</label>
              <input type="number" style={inp} value={row.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select style={inp} value={row.unit || ""} disabled={!row.isNewItem} onChange={(e) => onChange({ unit: e.target.value })}>
                <option value="">Select…</option>
                {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cost / unit (₹)</label>
              <input type="number" style={inp} value={row.costPrice} onChange={(e) => onChange({ costPrice: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <input style={inp} value={row.category} disabled={!row.isNewItem} onChange={(e) => onChange({ category: e.target.value })} placeholder="e.g. Grains" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Batch number (optional)</label>
              <input style={inp} value={row.batchNo} onChange={(e) => onChange({ batchNo: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Expiry date (optional)</label>
              <input type="date" style={inp} value={row.expiryDate || ""} onChange={(e) => onChange({ expiryDate: e.target.value })} />
            </div>
          </div>
          {needsReview && (
            <div style={{ fontSize: 11, color: "var(--wait-ink)", marginBottom: 8 }}>{issues.join(" · ")}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button type="button" className="zc-btn pri sm" onClick={onDone}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
