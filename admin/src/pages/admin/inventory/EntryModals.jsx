// src/pages/admin/inventory/EntryModals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The ways stock gets recorded, opened from the Inventory add bar, the stock
// rows and the item drawer. Every one of them is a thin form over an EXISTING
// endpoint — the server stays the authority for stock, cost and the ledger:
//   PurchaseModal  POST  /admin/inventory/purchases     (recordPurchase: +stock, cost price, PURCHASE ledger row,
//                  bill no./date/time/photo, Paid-from or Credit → payable)
//   WastageModal   POST  /admin/inventory/wastage       (recordWastage: −stock, costImpact, WASTAGE ledger row)
//   CountModal     PATCH /admin/inventory/items/:id/adjust  type PHYSICAL_COUNT (absolute value; server logs the difference)
//   AdjustModal    PATCH /admin/inventory/items/:id/adjust  type MANUAL_ADJUSTMENT
//   ItemFormModal  POST/PUT /admin/inventory/items       (definition only — currentStock is never sent)
// Nothing here edits currentStock directly or computes a stored value.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  createPurchase, createWastage, adjustInventoryItem, createInventoryItem, updateInventoryItem,
  createSupplier, uploadPurchaseBillPhoto,
} from "../../../services/inventoryService.js";
import TimePicker from "../../../components/TimePicker.jsx";
import { Modal } from "./invUI.jsx";
import { money, num, WASTAGE_REASONS, STOCK_UNITS } from "./invKit.js";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { unitLabel, formatQty, compatibleUnits, conversionFactor } from "../../../utils/units.js";

const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const toYmd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const signed = (n, unit) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n), { maximumFractionDigits: 3 })} ${unitLabel(unit)}`;
const activeFirst = (items) => items.filter((i) => i.status === "Active");

// ═══════════════════════════════ Record purchase ═══════════════════════════════
// Hotel KHOAI INV-01..07 (server rules: restaurant-server/utils/purchaseBill.js):
//   supplier      pick, or add one right here (INV-01)
//   bill number   the supplier's / read off the photo / your own; left empty the
//                 server makes a clearly marked system one (INV-02)
//   date + time   both required, never in the future (INV-03)
//   lines         a stock item, or a new item typed by hand — name + unit; the
//                 server links or creates the stock item (INV-04)
//   photo         kept as proof; its text suggests the bill number (INV-05)
//   payment       Paid (Cash drawer · Bank/UPI · Owner's pocket) or Credit — the
//                 supplier's terms pick the default (INV-06/07/14)
let lineUid = 0;
const newLine = (inventoryItem = "", costPrice = "", unit = "") =>
  ({ key: ++lineUid, manual: false, inventoryItem, name: "", unit, quantity: "", costPrice, batchNo: "", expiryDate: "" });
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const PAY_SOURCES = [
  { id: "CASH_DRAWER", label: N_("Cash drawer") },
  { id: "BANK_UPI", label: N_("Bank / UPI") },
  { id: "OWNER_POCKET", label: N_("Owner's pocket") },
];
const defaultPayFor = (s) => (s?.creditPreference === "GIVES_CREDIT" ? "CREDIT" : "PAID");

export function PurchaseModal({ items, suppliers, prefill = [], onClose, onSaved, onImport, onSupplierAdded }) {
  const byId = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  const choices = useMemo(() => activeFirst(items), [items]);
  const [supList, setSupList] = useState(suppliers);
  const [supplier, setSupplier] = useState(() => {
    // Pre-pick the default supplier when every prefilled item shares one.
    const ids = [...new Set(prefill.map((id) => byId.get(id)?.supplier?._id).filter(Boolean))];
    return ids.length === 1 ? ids[0] : "";
  });
  const [newSup, setNewSup] = useState(null); // null | { name, phone, saving }
  const [billNo, setBillNo] = useState("");
  const [billNoSource, setBillNoSource] = useState("SUPPLIER");
  const [billDate, setBillDate] = useState(() => toYmd(new Date()));
  const [billTime, setBillTime] = useState(nowHm);
  const [photo, setPhoto] = useState({ url: "", busy: false });
  const [payType, setPayType] = useState(() => defaultPayFor(suppliers.find((s) => s._id === supplier)));
  const [paySource, setPaySource] = useState("CASH_DRAWER");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState(() => (prefill.length
    ? prefill.map((id) => newLine(id, byId.get(id)?.costPrice ? String(byId.get(id).costPrice) : "", byId.get(id)?.unit || ""))
    : [newLine()]));
  const [saving, setSaving] = useState(false);

  const update = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (key, id) => {
    const it = byId.get(id);
    // Rate starts at the item's current cost price (the last purchase's rate) — editable.
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, inventoryItem: id, unit: it?.unit || "", costPrice: l.costPrice !== "" ? l.costPrice : (it?.costPrice ? String(it.costPrice) : "") }
      : l)));
  };
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.costPrice) || 0), 0);

  const chooseSupplier = (id) => {
    setSupplier(id);
    setPayType(defaultPayFor(supList.find((s) => s._id === id))); // INV-14
  };
  const addSupplier = async () => {
    const name = newSup?.name?.trim();
    if (!name) return toast.error(t("Supplier name is required"));
    setNewSup((p) => ({ ...p, saving: true }));
    try {
      const { data } = await createSupplier({ name, phone: newSup.phone || "" });
      const s = data?.supplier || data;
      setSupList((p) => [...p, s]);
      onSupplierAdded?.(s);
      chooseSupplier(s._id);
      setNewSup(null);
      toast.success(t("Supplier added"));
    } catch (err) {
      toast.error(errMsg(err, t("Couldn't add the supplier")));
      setNewSup((p) => (p ? { ...p, saving: false } : p));
    }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setPhoto({ url: "", busy: true });
    try {
      const { data } = await uploadPurchaseBillPhoto(file);
      setPhoto({ url: data.billPhoto || "", busy: false });
      // INV-05 → INV-02: a number read off the photo, only if none typed yet.
      if (data.billNumberGuess && !billNo.trim()) { setBillNo(data.billNumberGuess); setBillNoSource("PHOTO"); }
      if (data.billDateGuess && /^\d{4}-\d{2}-\d{2}/.test(data.billDateGuess)) {
        const d = String(data.billDateGuess).slice(0, 10);
        if (d <= toYmd(new Date())) setBillDate(d);
      }
      toast.success(data.billNumberGuess ? t("Photo saved — check the bill number we read") : t("Photo saved"));
    } catch (err) {
      setPhoto({ url: "", busy: false });
      toast.error(errMsg(err, t("Couldn't upload the photo")));
    }
  };

  const save = async () => {
    const filled = lines.filter((l) => l.inventoryItem || l.name.trim() || l.quantity || l.costPrice);
    const bad = filled.find((l) => (l.manual ? !l.name.trim() || !l.unit : !l.inventoryItem) || !(Number(l.quantity) > 0) || l.costPrice === "" || !(Number(l.costPrice) >= 0));
    if (!filled.length) return toast.error(t("Add at least one valid line item"));
    if (bad) return toast.error(t("Every line needs an item (or a typed name and unit), a quantity above 0 and a rate"));
    if (!billDate || !billTime) return toast.error(t("Bill date and time are required"));
    if (payType === "PAID" && !paySource) return toast.error(t("Choose where the money came from"));
    setSaving(true);
    try {
      await createPurchase({
        supplier: supplier || null,
        billNumber: billNo.trim(),
        billNumberSource: billNo.trim() ? billNoSource : undefined,
        billDate, billTime,
        billPhoto: photo.url || undefined,
        paymentType: payType,
        paymentSource: payType === "PAID" ? paySource : undefined,
        notes,
        items: filled.map((l) => (l.manual
          ? { name: l.name.trim(), unit: l.unit, quantity: Number(l.quantity), costPrice: Number(l.costPrice) }
          : {
            inventoryItem: l.inventoryItem, unit: l.unit || undefined, quantity: Number(l.quantity), costPrice: Number(l.costPrice),
            batchNo: l.batchNo || "", expiryDate: l.expiryDate || null,
          })),
      });
      toast.success(payType === "CREDIT" || paySource === "OWNER_POCKET"
        ? t("Purchase recorded — stock updated, added to money owed")
        : t("Purchase recorded — stock updated"));
      onSaved();
    } catch (err) { toast.error(errMsg(err, t("Failed to record purchase"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={t("Record purchase")}
      sub={t("Stock goes up by each line and the item's cost price becomes this rate. Every line is written to the stock history.")}
      onClose={onClose}
      width={800}
      footer={
        <>
          <span className="ivt-mfoot-l">{t("Total")}<b>{money(total)}</b></span>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving || photo.busy} onClick={save}>{saving ? t("Saving…") : t("Save purchase")}</button>
        </>
      }
    >
      {/* Supplier (INV-01) */}
      <div style={{ marginBottom: 14 }}>
        <label className="ivt-fl" htmlFor="pm-sup">{t("Supplier")}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select id="pm-sup" className="zc-select" style={{ flex: "1 1 220px" }} value={supplier} onChange={(e) => chooseSupplier(e.target.value)}>
            <option value="">— {t("none")} —</option>
            {supList.filter((s) => s.status !== "Inactive" || s._id === supplier).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          {!newSup && <button type="button" className="zc-btn ghost" onClick={() => setNewSup({ name: "", phone: "" })}>＋ {t("New supplier")}</button>}
        </div>
        {newSup && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, padding: 10, border: "1px dashed var(--edge)", borderRadius: 10 }}>
            <input className="zc-input" style={{ flex: "2 1 180px" }} placeholder={t("Supplier name")} aria-label={t("Supplier name")} autoFocus
              value={newSup.name} onChange={(e) => setNewSup((p) => ({ ...p, name: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addSupplier()} />
            <input className="zc-input" style={{ flex: "1 1 130px" }} placeholder={t("Phone (optional)")} aria-label={t("Phone")} inputMode="tel"
              value={newSup.phone} onChange={(e) => setNewSup((p) => ({ ...p, phone: e.target.value }))} />
            <button type="button" className="zc-btn pri" disabled={newSup.saving} onClick={addSupplier}>{newSup.saving ? t("Saving…") : t("Add")}</button>
            <button type="button" className="zc-btn ghost" onClick={() => setNewSup(null)}>{t("Cancel")}</button>
          </div>
        )}
      </div>

      {/* Bill number · date · time · photo (INV-02/03/05) */}
      <div className="ivt-grid2" style={{ marginBottom: 6 }}>
        <div>
          <label className="ivt-fl" htmlFor="pm-inv">{t("Bill no.")} <small>({t("optional")})</small></label>
          <input id="pm-inv" className="zc-input" value={billNo} maxLength={40}
            onChange={(e) => { setBillNo(e.target.value); if (billNoSource === "PHOTO") setBillNoSource("SUPPLIER"); }} />
          <div className="ivt-hint" style={{ marginTop: 5 }}>
            {billNo.trim()
              ? (billNoSource === "PHOTO" ? t("Read from the photo — check it") : (
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={billNoSource === "MANUAL"} onChange={(e) => setBillNoSource(e.target.checked ? "MANUAL" : "SUPPLIER")} />
                  {t("The bill had no number — this is my own")}
                </label>
              ))
              : t("No number? Leave it empty — a system number (AUTO-…) is made and marked as system-generated.")}
          </div>
        </div>
        <div className="ivt-grid2" style={{ gap: 8 }}>
          <div>
            <label className="ivt-fl" htmlFor="pm-date">{t("Bill date")} *</label>
            <input id="pm-date" type="date" className="zc-input" value={billDate} max={toYmd(new Date())} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div>
            <span className="ivt-fl">{t("Bill time")} *</span>
            <TimePicker ariaLabel={t("Bill time")} value={billTime} onChange={setBillTime} step={1} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0 14px" }}>
        <label className="zc-btn ghost sm" style={{ cursor: photo.busy ? "wait" : "pointer" }}>
          📷 {photo.url ? t("Replace bill photo") : t("Add bill photo")}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={photo.busy}
            onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {photo.busy && <span className="ivt-hint">{t("Uploading and reading the bill…")}</span>}
        {photo.url && !photo.busy && (
          <>
            <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={t("Bill photo")} style={{ height: 40, borderRadius: 6, border: "1px solid var(--edge)" }} /></a>
            <button type="button" className="ivt-link" onClick={() => setPhoto({ url: "", busy: false })}>{t("Remove")}</button>
          </>
        )}
      </div>

      {/* Lines (INV-04) */}
      <table className="ivt-mtable stack">
        <thead>
          <tr><th>{t("Item")}</th><th style={{ width: 150 }}>{t("Qty")}</th><th style={{ width: 120 }}>{t("Rate")}</th><th className="num" style={{ width: 100 }}>{t("Amount")}</th><th style={{ width: 30 }} /></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const it = l.manual ? null : byId.get(l.inventoryItem);
            const units = l.manual ? STOCK_UNITS : it ? compatibleUnits(it.unit) : [];
            const amount = (Number(l.quantity) || 0) * (Number(l.costPrice) || 0);
            return [
              <tr key={l.key}>
                <td className="wide" data-k={t("Item")}>
                  {l.manual ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input className="zc-input" placeholder={t("Item name, e.g. Mustard oil")} aria-label={t("Item name")} value={l.name}
                        onChange={(e) => update(l.key, { name: e.target.value })} />
                      <button type="button" className="ivt-link" onClick={() => update(l.key, { manual: false, name: "", unit: "" })}>{t("Pick from stock")}</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <select className="zc-select" value={l.inventoryItem} onChange={(e) => pick(l.key, e.target.value)} aria-label={t("Item")}>
                        <option value="">{t("Select item…")}</option>
                        {choices.map((i) => <option key={i._id} value={i._id}>{localName(i)} ({formatQty(i.currentStock, i.unit)})</option>)}
                      </select>
                      <button type="button" className="ivt-link" style={{ whiteSpace: "nowrap" }} onClick={() => update(l.key, { manual: true, inventoryItem: "", unit: "pcs" })}>{t("Not in stock list?")}</button>
                    </div>
                  )}
                </td>
                <td data-k={t("Qty")}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={l.quantity}
                      placeholder={t("Qty")} aria-label={t("Quantity")} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                    {units.length > 0 && (
                      <select className="zc-select" style={{ width: "auto" }} aria-label={t("Unit")} value={l.unit}
                        onChange={(e) => update(l.key, { unit: e.target.value })}>
                        {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td data-k={l.unit ? t("Rate per {unit}", { unit: unitLabel(l.unit) }) : t("Rate")}>
                  <input type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={l.costPrice}
                    placeholder="₹" aria-label={t("Rate")}
                    onChange={(e) => update(l.key, { costPrice: e.target.value })} />
                </td>
                <td className="num" data-k={t("Amount")} style={{ fontWeight: 600 }}>{money(amount)}</td>
                <td>
                  {lines.length > 1 && <button type="button" className="ivt-x" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} aria-label={t("Remove line")}>✕</button>}
                </td>
              </tr>,
              l.manual && (
                <tr key={`${l.key}-m`}>
                  <td colSpan={5} className="wide"><div className="ivt-hint">{t("Added to your stock list as a new item (or matched to one with the same name).")}</div></td>
                </tr>
              ),
              it?.isBatchTracked && (
                <tr key={`${l.key}-b`}>
                  <td colSpan={5} className="wide">
                    <div className="ivt-grid2" style={{ gap: 8 }}>
                      <input className="zc-input" placeholder={t("Batch no. (optional)")} value={l.batchNo} aria-label={t("Batch no.")}
                        onChange={(e) => update(l.key, { batchNo: e.target.value })} />
                      <input type="date" className="zc-input" value={l.expiryDate} title={t("Expiry date")} aria-label={t("Expiry date")}
                        onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                    </div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" className="zc-btn ghost sm" onClick={() => setLines((p) => [...p, newLine()])}>＋ {t("Add line")}</button>
        {onImport && <button type="button" className="ivt-link" onClick={onImport}>{t("Have the bill as a photo or PDF? Import it instead")} →</button>}
      </div>

      {/* Payment (INV-06/07) */}
      <div style={{ marginTop: 16 }}>
        <span className="ivt-fl">{t("Payment")} *</span>
        <div className="ivt-opts" role="radiogroup" aria-label={t("Payment")}>
          <button type="button" role="radio" aria-checked={payType === "PAID"} className={payType === "PAID" ? "on" : ""} onClick={() => setPayType("PAID")}>{t("Paid")}</button>
          <button type="button" role="radio" aria-checked={payType === "CREDIT"} className={payType === "CREDIT" ? "on" : ""} onClick={() => setPayType("CREDIT")}>{t("Credit (pay later)")}</button>
        </div>
        {payType === "PAID" ? (
          <>
            <div className="ivt-opts" role="radiogroup" aria-label={t("Paid from")} style={{ marginTop: 8 }}>
              {PAY_SOURCES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={paySource === s.id} className={paySource === s.id ? "on" : ""}
                  onClick={() => setPaySource(s.id)}>{t(s.label)}</button>
              ))}
            </div>
            {paySource === "OWNER_POCKET" && (
              <div className="ivt-hint" style={{ marginTop: 6 }}>{t("The owner lent this money — it is shown as owed to the owner until the business pays it back.")}</div>
            )}
          </>
        ) : (
          <div className="ivt-hint" style={{ marginTop: 6 }}>{t("Shown as owed to the supplier until you pay it back.")}</div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="ivt-fl" htmlFor="pm-notes">{t("Notes")}</label>
        <input id="pm-notes" className="zc-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ═══════════════════════════════ Log wastage ═══════════════════════════════
// INV-08 a stock item or something typed by hand (not stocked) · INV-09 any
// compatible unit (weighed in g, stocked in kg) · INV-10 "Other" needs a reason.
export function WastageModal({ items, prefillItem = "", onClose, onSaved }) {
  const choices = useMemo(() => activeFirst(items), [items]);
  const [form, setForm] = useState({
    manual: false, inventoryItem: prefillItem, itemName: "", unit: items.find((i) => i._id === prefillItem)?.unit || "",
    quantity: "", cost: "", reason: "Spoilage", reasonText: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const it = form.manual ? null : items.find((i) => i._id === form.inventoryItem);
  const qty = Number(form.quantity) || 0;
  const factor = it && form.unit ? conversionFactor(form.unit, it.unit) : 1;
  const stockQty = qty * (factor || 1);
  const tooMuch = it && stockQty > Number(it.currentStock || 0);
  const units = form.manual ? STOCK_UNITS : it ? compatibleUnits(it.unit) : [];

  const save = async () => {
    if (form.manual ? !form.itemName.trim() || !form.unit : !form.inventoryItem) return toast.error(t("Pick a stock item or type the item name"));
    if (!(qty > 0)) return toast.error(t("Select an item and a quantity > 0"));
    if (tooMuch) return toast.error(t("Insufficient stock to record this wastage"));
    if (form.reason === "Other" && !form.reasonText.trim()) return toast.error(t("Write the reason"));
    setSaving(true);
    try {
      await createWastage(form.manual
        ? { itemName: form.itemName.trim(), unit: form.unit, quantity: qty, cost: form.cost === "" ? undefined : Number(form.cost), reason: form.reason, reasonText: form.reasonText, notes: form.notes }
        : { inventoryItem: form.inventoryItem, unit: form.unit || undefined, quantity: qty, reason: form.reason, reasonText: form.reasonText, notes: form.notes });
      toast.success(t("Wastage recorded"));
      onSaved();
    } catch (err) { toast.error(errMsg(err, t("Failed to record wastage"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={t("Log wastage")}
      sub={t("Deducts stock and records the cost impact")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Record wastage")}</button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label className="ivt-fl" htmlFor="wm-item">{t("Item")}</label>
          {form.manual ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input id="wm-item" className="zc-input" value={form.itemName} placeholder={t("e.g. Leftover rice")}
                onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
              <button type="button" className="ivt-link" style={{ whiteSpace: "nowrap" }} onClick={() => setForm({ ...form, manual: false, itemName: "", unit: "" })}>{t("Pick from stock")}</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <select id="wm-item" className="zc-select" value={form.inventoryItem}
                onChange={(e) => setForm({ ...form, inventoryItem: e.target.value, unit: items.find((i) => i._id === e.target.value)?.unit || "" })}>
                <option value="">{t("Select item…")}</option>
                {choices.map((i) => <option key={i._id} value={i._id}>{localName(i)} ({t("{qty} in stock", { qty: formatQty(i.currentStock, i.unit) })})</option>)}
              </select>
              <button type="button" className="ivt-link" style={{ whiteSpace: "nowrap" }} onClick={() => setForm({ ...form, manual: true, inventoryItem: "", unit: "pcs" })}>{t("Not in stock list?")}</button>
            </div>
          )}
          {form.manual && <div className="ivt-hint" style={{ marginTop: 5 }}>{t("Recorded as a loss only — no stock item to deduct.")}</div>}
        </div>
        <div className="ivt-grid2" style={{ gap: 8 }}>
          <div>
            <label className="ivt-fl" htmlFor="wm-qty">{t("Quantity")}</label>
            <div style={{ display: "flex", gap: 4 }}>
              <input id="wm-qty" type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              {units.length > 0 && (
                <select className="zc-select" style={{ width: "auto" }} aria-label={t("Unit")} value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              )}
            </div>
            {it && (
              <div className="ivt-hint" style={{ marginTop: 5, color: tooMuch ? "var(--stop-ink)" : undefined }}>
                {tooMuch
                  ? t("Only {qty} in stock", { qty: formatQty(it.currentStock, it.unit) })
                  : t("Cost impact about {amount} at the current cost price", { amount: money(stockQty * Number(it.costPrice || 0)) })}
              </div>
            )}
          </div>
          {form.manual && (
            <div>
              <label className="ivt-fl" htmlFor="wm-cost">{t("Cost (₹)")} <small>({t("optional")})</small></label>
              <input id="wm-cost" type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </div>
          )}
        </div>
        <div>
          <span className="ivt-fl">{t("Reason")}</span>
          <div className="ivt-opts" role="group" aria-label={t("Reason")}>
            {WASTAGE_REASONS.map((r) => (
              <button key={r} type="button" className={form.reason === r ? "on" : ""} aria-pressed={form.reason === r}
                onClick={() => setForm({ ...form, reason: r })}>{t(r === "Other" ? "Others" : r)}</button>
            ))}
          </div>
          {form.reason === "Other" && (
            <input className="zc-input" style={{ marginTop: 8 }} maxLength={200} autoFocus aria-label={t("Reason")}
              placeholder={t("What happened? e.g. dropped on the floor")} value={form.reasonText}
              onChange={(e) => setForm({ ...form, reasonText: e.target.value })} />
          )}
        </div>
        <div>
          <label className="ivt-fl" htmlFor="wm-notes">{t("Notes")}</label>
          <input id="wm-notes" className="zc-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════ Count stock ═══════════════════════════════
// A physical count is an absolute "this is on the shelf" value per item; the
// server works out and logs the difference (adjustStock, PHYSICAL_COUNT).
// Only rows whose counted value differs from the system figure are saved.
export function CountModal({ items, only, onClose, onSaved }) {
  const rows = useMemo(() => {
    const list = only ? items.filter((i) => i._id === only) : activeFirst(items);
    return [...list].sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name));
  }, [items, only]);
  const categories = useMemo(() => [...new Set(rows.map((i) => i.category).filter(Boolean))].sort(), [rows]);
  const [counts, setCounts] = useState(() => new Map(rows.map((i) => [i._id, String(i.currentStock ?? 0)])));
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const setCount = (id, v) => setCounts((m) => new Map(m).set(id, v));
  const step = (it, d) => {
    const cur = Number(counts.get(it._id));
    setCount(it._id, String(Math.max(0, Math.round(((Number.isFinite(cur) ? cur : 0) + d) * 1000) / 1000)));
  };
  const diffOf = (it) => {
    const v = counts.get(it._id);
    if (v === "" || !Number.isFinite(Number(v))) return null;
    return Math.round((Number(v) - Number(it.currentStock || 0)) * 1000) / 1000;
  };
  const changed = rows.filter((it) => { const d = diffOf(it); return d != null && d !== 0; });
  const invalid = rows.filter((it) => { const v = counts.get(it._id); return v === "" || !(Number(v) >= 0); });
  const valueChange = changed.reduce((s, it) => s + diffOf(it) * Number(it.costPrice || 0), 0);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((it) => (!cat || it.category === cat)
    && (!q || it.name.toLowerCase().includes(q) || (it.nameBn || "").toLowerCase().includes(q)));

  const save = async () => {
    if (invalid.length) return toast.error(t("Enter a valid stock value"));
    if (!changed.length) return toast(t("No changes to save — every count matches the system"));
    setSaving(true);
    const failed = [];
    for (const it of changed) {
      try {
        await adjustInventoryItem(it._id, { newStock: Number(counts.get(it._id)), type: "PHYSICAL_COUNT", reason: reason.trim() });
      } catch (err) { failed.push(`${localName(it)}: ${errMsg(err, t("Adjustment failed"))}`); }
    }
    setSaving(false);
    const ok = changed.length - failed.length;
    if (ok) toast.success(tn(ok, "Count saved for {n} item", "Count saved for {n} items"));
    if (failed.length) { toast.error(failed.join("\n")); if (ok) onSaved({ keepOpen: true }); return; }
    onSaved();
  };

  return (
    <Modal
      title={only ? t("Physical stock count") : t("Count stock")}
      sub={only
        ? t("{name} — currently {qty}", { name: localName(rows[0] || {}), qty: rows[0] ? formatQty(rows[0].currentStock, rows[0].unit) : "" })
        : t("Enter what is on the shelf now. Only items that differ are saved; each difference is written to the stock history.")}
      onClose={onClose}
      width={only ? 520 : 820}
      footer={
        <>
          <span className="ivt-mfoot-l">
            {tn(changed.length, "{n} item changed", "{n} items changed")}
            {changed.length > 0 && <b style={{ color: valueChange < 0 ? "var(--stop-ink)" : "var(--ready-ink)" }}>{valueChange < 0 ? "−" : "+"}{money(Math.abs(valueChange))}</b>}
          </span>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Save count")}</button>
        </>
      }
    >
      {!only && (
        <div className="ivt-fbar" style={{ marginBottom: 12 }}>
          <input className="zc-input search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search stock items")} aria-label={t("Search stock items")} />
          {categories.length > 0 && (
            <select className="zc-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("Category filter")}>
              <option value="">{t("Category: All")}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}
      <div className={only ? undefined : "ivt-mscroll"}>
        <table className="ivt-mtable stack">
          <thead>
            <tr><th>{t("Item")}</th><th className="num">{t("In system")}</th><th>{t("Counted")}</th><th className="num">{t("Difference")}</th><th className="num">{t("Value")}</th></tr>
          </thead>
          <tbody>
            {visible.map((it) => {
              const d = diffOf(it);
              return (
                <tr key={it._id} className={d ? "changed" : undefined}>
                  <td className="wide" data-k={t("Item")}>
                    <div style={{ fontWeight: 600 }}>{localName(it)}</div>
                    {it.category && <div className="ivt-hint">{it.category}</div>}
                  </td>
                  <td className="num" data-k={t("In system")}>{formatQty(it.currentStock, it.unit)}</td>
                  <td data-k={`${t("Counted")} (${unitLabel(it.unit)})`}>
                    <span className="ivt-step">
                      <button type="button" onClick={() => step(it, -1)} aria-label={t("Decrease")}>−</button>
                      <input type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={counts.get(it._id) ?? ""}
                        aria-label={t("Counted quantity")} onChange={(e) => setCount(it._id, e.target.value)} />
                      <button type="button" onClick={() => step(it, 1)} aria-label={t("Increase")}>+</button>
                    </span>
                  </td>
                  <td className="num" data-k={t("Difference")} style={{ fontWeight: 700, color: !d ? "var(--text-3)" : d < 0 ? "var(--stop-ink)" : "var(--ready-ink)" }}>
                    {d == null ? "—" : d === 0 ? "0" : signed(d, it.unit)}
                  </td>
                  <td className="num" data-k={t("Value")} style={{ color: "var(--text-2)" }}>
                    {d ? `${d < 0 ? "−" : "+"}${money(Math.abs(d * Number(it.costPrice || 0)))}` : "—"}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-3)", padding: 20 }}>{t("No items match these filters")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14 }}>
        <label className="ivt-fl" htmlFor="cm-reason">{t("Reason")} <small>({t("optional")})</small></label>
        <input id="cm-reason" className="zc-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Monthly count")} />
      </div>
    </Modal>
  );
}

// ═══════════════════════════════ Adjust stock ═══════════════════════════════
const ADJ_MODES = [["add", "Add"], ["remove", "Remove"], ["set", "Set to"]];
export function AdjustModal({ item, onClose, onSaved }) {
  const [mode, setMode] = useState("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const cur = Number(item.currentStock || 0);
  const a = Number(amount);
  const valid = amount !== "" && Number.isFinite(a) && a >= 0;
  const newStock = !valid ? null : Math.round((mode === "add" ? cur + a : mode === "remove" ? cur - a : a) * 1000) / 1000;
  const diff = newStock == null ? 0 : Math.round((newStock - cur) * 1000) / 1000;

  const save = async () => {
    if (newStock == null || newStock < 0) return toast.error(newStock < 0 ? t("Only {qty} in stock", { qty: formatQty(cur, item.unit) }) : t("Enter a valid stock value"));
    if (diff === 0) return toast(t("No change — the stock stays the same"));
    setSaving(true);
    try {
      await adjustInventoryItem(item._id, { newStock, type: "MANUAL_ADJUSTMENT", reason: reason.trim() });
      toast.success(t("Stock updated"));
      onSaved();
    } catch (err) { toast.error(errMsg(err, t("Adjustment failed"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={t("Adjust stock")}
      sub={t("{name} — currently {qty}", { name: localName(item), qty: formatQty(cur, item.unit) })}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Confirm")}</button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="zc-seg" role="tablist" aria-label={t("Adjustment type")}>
          {ADJ_MODES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{t(l)}</button>
          ))}
        </div>
        <div>
          <label className="ivt-fl" htmlFor="am-amt">{mode === "set" ? t("New stock value") : t("Quantity")} ({unitLabel(item.unit)})</label>
          <input id="am-amt" type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="ivt-note" aria-live="polite">
          {t("Now")} <b style={{ color: "var(--text-1)" }}>{formatQty(cur, item.unit)}</b> → {t("after")}{" "}
          <b style={{ color: newStock != null && newStock < 0 ? "var(--stop-ink)" : "var(--text-1)" }}>{newStock == null ? "—" : formatQty(newStock, item.unit)}</b>
          {diff !== 0 && <> · {t("Logged difference:")} <b style={{ color: diff > 0 ? "var(--ready-ink)" : "var(--stop-ink)" }}>{signed(diff, item.unit)}</b></>}
        </div>
        <div>
          <label className="ivt-fl" htmlFor="am-reason">{t("Reason")}</label>
          <input id="am-reason" className="zc-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Correcting entry error")} />
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════ Add / edit stock item ═══════════════════════════════
const emptyItem = { name: "", nameBn: "", unit: "kg", category: "", reorderLevel: 0, criticalLevel: 0, costPrice: 0, supplier: "", isBatchTracked: false, notes: "" };

export function ItemFormModal({ item, items, suppliers, onClose, onSaved }) {
  const [form, setForm] = useState(() => (item ? {
    name: item.name, nameBn: item.nameBn || "", unit: item.unit, category: item.category || "",
    reorderLevel: item.reorderLevel ?? 0, criticalLevel: item.criticalLevel ?? 0, costPrice: item.costPrice ?? 0,
    supplier: item.supplier?._id || "", isBatchTracked: !!item.isBatchTracked, notes: item.notes || "",
  } : emptyItem));
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const u = unitLabel(form.unit) || t("unit");

  const save = async () => {
    if (!form.name.trim()) return toast.error(t("Item name is required"));
    const n = (v) => (v === "" || v == null ? 0 : Number(v));
    if ([form.reorderLevel, form.criticalLevel, form.costPrice].some((v) => !(n(v) >= 0))) return toast.error(t("Levels and cost can't be negative"));
    setSaving(true);
    try {
      const payload = {
        ...form, name: form.name.trim(), category: form.category.trim(), supplier: form.supplier || null,
        reorderLevel: n(form.reorderLevel), criticalLevel: n(form.criticalLevel), costPrice: n(form.costPrice),
      };
      if (item) { await updateInventoryItem(item._id, payload); toast.success(t("Item updated")); }
      else { await createInventoryItem(payload); toast.success(t("Item created — add stock via a Purchase")); }
      onSaved();
    } catch (err) { toast.error(errMsg(err, t("Save failed"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={item ? t("Edit stock item") : t("Add stock item")}
      sub={item ? localName(item) : t("Name and unit are all you need; the rest can wait.")}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving} onClick={save}>
            {saving ? t("Saving…") : item ? t("Save changes") : t("Create item")}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="ivt-grid2">
          <div>
            <label className="ivt-fl" htmlFor="if-name">{t("Item name")}</label>
            <input id="if-name" className="zc-input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("e.g. Basmati Rice")} />
          </div>
          <div>
            <label className="ivt-fl" htmlFor="if-bn">{t("Bengali name")} <small>({t("optional")})</small></label>
            <input id="if-bn" className="zc-input" lang="bn" value={form.nameBn} onChange={(e) => set({ nameBn: e.target.value })} placeholder={t("e.g. বাসমতি চাল")} />
          </div>
        </div>
        <div>
          <span className="ivt-fl">{t("Unit")}</span>
          <div className="ivt-opts" role="group" aria-label={t("Unit")}>
            {STOCK_UNITS.map((x) => (
              <button key={x} type="button" className={form.unit === x ? "on" : ""} aria-pressed={form.unit === x} onClick={() => set({ unit: x })}>{unitLabel(x)}</button>
            ))}
          </div>
          {item && item.unit !== form.unit && (
            <div className="ivt-note warn" style={{ marginTop: 8 }}>
              {t("Changing the unit does not convert the {qty} already in stock — check the quantity after saving.", { qty: `${num(item.currentStock)} ${unitLabel(item.unit)}` })}
            </div>
          )}
        </div>
        <div>
          <label className="ivt-fl" htmlFor="if-cat">{t("Category")}</label>
          <input id="if-cat" className="zc-input" value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder={t("e.g. Grains")} />
          {categories.length > 0 && (
            <div className="ivt-opts" style={{ marginTop: 8 }} role="group" aria-label={t("Existing categories")}>
              {categories.map((c) => (
                <button key={c} type="button" className={form.category === c ? "on" : ""} aria-pressed={form.category === c} onClick={() => set({ category: c })}>{c}</button>
              ))}
            </div>
          )}
        </div>
        <div className="ivt-grid2">
          <div>
            <label className="ivt-fl" htmlFor="if-ro">{t("Reorder level ({unit})", { unit: u })}</label>
            <input id="if-ro" type="number" min="0" step="any" className="zc-input" value={form.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} />
          </div>
          <div>
            <label className="ivt-fl" htmlFor="if-cr">{t("Critical level ({unit})", { unit: u })}</label>
            <input id="if-cr" type="number" min="0" step="any" className="zc-input" value={form.criticalLevel} onChange={(e) => set({ criticalLevel: e.target.value })} />
          </div>
          <div>
            <label className="ivt-fl" htmlFor="if-cost">{t("Cost price per {unit} (₹)", { unit: u })}</label>
            <input id="if-cost" type="number" min="0" step="any" className="zc-input" value={form.costPrice} onChange={(e) => set({ costPrice: e.target.value })} />
          </div>
          <div>
            <label className="ivt-fl" htmlFor="if-sup">{t("Default supplier")}</label>
            <select id="if-sup" className="zc-select" value={form.supplier} onChange={(e) => set({ supplier: e.target.value })}>
              <option value="">— {t("none")} —</option>
              {suppliers.filter((s) => s.status === "Active" || s._id === form.supplier).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-2)" }}>
          <input type="checkbox" checked={form.isBatchTracked} onChange={(e) => set({ isBatchTracked: e.target.checked })} />
          {t("Track batches / expiry dates for this item")}
        </label>
        <div>
          <label className="ivt-fl" htmlFor="if-notes">{t("Notes")}</label>
          <input id="if-notes" className="zc-input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        {!item && <div className="ivt-note">{t("New items start at 0 stock — record a Purchase afterwards to bring stock in.")}</div>}
      </div>
    </Modal>
  );
}
