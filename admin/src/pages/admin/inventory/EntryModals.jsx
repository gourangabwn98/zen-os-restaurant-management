// src/pages/admin/inventory/EntryModals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The ways stock gets recorded, opened from the Inventory add bar, the stock
// rows and the item drawer. Every one of them is a thin form over an EXISTING
// endpoint — the server stays the authority for stock, cost and the ledger:
//   PurchaseModal  POST  /admin/inventory/purchases     (recordPurchase: +stock, cost price, PURCHASE ledger row)
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
} from "../../../services/inventoryService.js";
import { Modal } from "./invUI.jsx";
import { money, num, WASTAGE_REASONS, STOCK_UNITS } from "./invKit.js";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import { unitLabel, formatQty } from "../../../utils/units.js";

const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const toYmd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const signed = (n, unit) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n), { maximumFractionDigits: 3 })} ${unitLabel(unit)}`;
const activeFirst = (items) => items.filter((i) => i.status === "Active");

// ═══════════════════════════════ Record purchase ═══════════════════════════════
let lineUid = 0;
const newLine = (inventoryItem = "", costPrice = "") => ({ key: ++lineUid, inventoryItem, quantity: "", costPrice, batchNo: "", expiryDate: "" });

export function PurchaseModal({ items, suppliers, prefill = [], onClose, onSaved, onImport }) {
  const byId = useMemo(() => new Map(items.map((i) => [i._id, i])), [items]);
  const choices = useMemo(() => activeFirst(items), [items]);
  const [supplier, setSupplier] = useState(() => {
    // Pre-pick the default supplier when every prefilled item shares one.
    const ids = [...new Set(prefill.map((id) => byId.get(id)?.supplier?._id).filter(Boolean))];
    return ids.length === 1 ? ids[0] : "";
  });
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => toYmd(new Date()));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState(() => (prefill.length
    ? prefill.map((id) => newLine(id, byId.get(id)?.costPrice ? String(byId.get(id).costPrice) : ""))
    : [newLine()]));
  const [saving, setSaving] = useState(false);

  const update = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (key, id) => {
    const it = byId.get(id);
    // Rate starts at the item's current cost price (the last purchase's rate) — editable.
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, inventoryItem: id, costPrice: l.costPrice !== "" ? l.costPrice : (it?.costPrice ? String(it.costPrice) : "") }
      : l)));
  };
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.costPrice) || 0), 0);

  const save = async () => {
    const valid = lines.filter((l) => l.inventoryItem && Number(l.quantity) > 0 && l.costPrice !== "" && Number(l.costPrice) >= 0);
    if (!valid.length) return toast.error(t("Add at least one valid line item"));
    if (valid.length !== lines.filter((l) => l.inventoryItem || l.quantity || l.costPrice).length) {
      return toast.error(t("Every line needs an item, a quantity above 0 and a rate"));
    }
    setSaving(true);
    try {
      await createPurchase({
        supplier: supplier || null,
        invoiceNumber: invoiceNumber.trim(),
        notes,
        // Today → let the server stamp "now"; a past bill date is sent as-is.
        purchaseDate: purchaseDate && purchaseDate !== toYmd(new Date()) ? purchaseDate : undefined,
        items: valid.map((l) => ({
          inventoryItem: l.inventoryItem, quantity: Number(l.quantity), costPrice: Number(l.costPrice),
          batchNo: l.batchNo || "", expiryDate: l.expiryDate || null,
        })),
      });
      toast.success(t("Purchase recorded — stock updated"));
      onSaved();
    } catch (err) { toast.error(errMsg(err, t("Failed to record purchase"))); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={t("Record purchase")}
      sub={t("Stock goes up by each line and the item's cost price becomes this rate. Every line is written to the stock history.")}
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="ivt-mfoot-l">{t("Total")}<b>{money(total)}</b></span>
          <button type="button" className="zc-btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri" disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Save purchase")}</button>
        </>
      }
    >
      <div className="ivt-grid2" style={{ marginBottom: 14 }}>
        <div>
          <label className="ivt-fl" htmlFor="pm-sup">{t("Supplier")}</label>
          <select id="pm-sup" className="zc-select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">— {t("none")} —</option>
            {suppliers.filter((s) => s.status === "Active" || s._id === supplier).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </div>
        <div className="ivt-grid2" style={{ gap: 8 }}>
          <div>
            <label className="ivt-fl" htmlFor="pm-inv">{t("Bill no.")}</label>
            <input id="pm-inv" className="zc-input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label className="ivt-fl" htmlFor="pm-date">{t("Bill date")}</label>
            <input id="pm-date" type="date" className="zc-input" value={purchaseDate} max={toYmd(new Date())} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
        </div>
      </div>

      <table className="ivt-mtable stack">
        <thead>
          <tr><th>{t("Item")}</th><th style={{ width: 110 }}>{t("Qty")}</th><th style={{ width: 120 }}>{t("Rate")}</th><th className="num" style={{ width: 100 }}>{t("Amount")}</th><th style={{ width: 30 }} /></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const it = byId.get(l.inventoryItem);
            const amount = (Number(l.quantity) || 0) * (Number(l.costPrice) || 0);
            return [
              <tr key={l.key}>
                <td className="wide" data-k={t("Item")}>
                  <select className="zc-select" value={l.inventoryItem} onChange={(e) => pick(l.key, e.target.value)} aria-label={t("Item")}>
                    <option value="">{t("Select item…")}</option>
                    {choices.map((i) => <option key={i._id} value={i._id}>{localName(i)} ({formatQty(i.currentStock, i.unit)})</option>)}
                  </select>
                </td>
                <td data-k={`${t("Qty")}${it ? ` (${unitLabel(it.unit)})` : ""}`}>
                  <input type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={l.quantity}
                    placeholder={it ? unitLabel(it.unit) : t("Qty")} aria-label={t("Quantity")}
                    onChange={(e) => update(l.key, { quantity: e.target.value })} />
                </td>
                <td data-k={it ? t("Rate per {unit}", { unit: unitLabel(it.unit) }) : t("Rate")}>
                  <input type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={l.costPrice}
                    placeholder="₹" aria-label={t("Rate")}
                    onChange={(e) => update(l.key, { costPrice: e.target.value })} />
                </td>
                <td className="num" data-k={t("Amount")} style={{ fontWeight: 600 }}>{money(amount)}</td>
                <td>
                  {lines.length > 1 && <button type="button" className="ivt-x" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} aria-label={t("Remove line")}>✕</button>}
                </td>
              </tr>,
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
      <div style={{ marginTop: 14 }}>
        <label className="ivt-fl" htmlFor="pm-notes">{t("Notes")}</label>
        <input id="pm-notes" className="zc-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

// ═══════════════════════════════ Log wastage ═══════════════════════════════
export function WastageModal({ items, prefillItem = "", onClose, onSaved }) {
  const choices = useMemo(() => activeFirst(items), [items]);
  const [form, setForm] = useState({ inventoryItem: prefillItem, quantity: "", reason: "Spoilage", notes: "" });
  const [saving, setSaving] = useState(false);
  const it = items.find((i) => i._id === form.inventoryItem);
  const qty = Number(form.quantity) || 0;
  const tooMuch = it && qty > Number(it.currentStock || 0);

  const save = async () => {
    if (!form.inventoryItem || !(qty > 0)) return toast.error(t("Select an item and a quantity > 0"));
    if (tooMuch) return toast.error(t("Insufficient stock to record this wastage"));
    setSaving(true);
    try {
      await createWastage({ ...form, quantity: qty });
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
          <select id="wm-item" className="zc-select" value={form.inventoryItem} onChange={(e) => setForm({ ...form, inventoryItem: e.target.value })}>
            <option value="">{t("Select item…")}</option>
            {choices.map((i) => <option key={i._id} value={i._id}>{localName(i)} ({t("{qty} in stock", { qty: formatQty(i.currentStock, i.unit) })})</option>)}
          </select>
        </div>
        <div>
          <label className="ivt-fl" htmlFor="wm-qty">{t("Quantity")} {it ? `(${unitLabel(it.unit)})` : ""}</label>
          <input id="wm-qty" type="number" min="0" step="any" inputMode="decimal" className="zc-input" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          {it && (
            <div className="ivt-hint" style={{ marginTop: 5, color: tooMuch ? "var(--stop-ink)" : undefined }}>
              {tooMuch
                ? t("Only {qty} in stock", { qty: formatQty(it.currentStock, it.unit) })
                : t("Cost impact about {amount} at the current cost price", { amount: money(qty * Number(it.costPrice || 0)) })}
            </div>
          )}
        </div>
        <div>
          <span className="ivt-fl">{t("Reason")}</span>
          <div className="ivt-opts" role="group" aria-label={t("Reason")}>
            {WASTAGE_REASONS.map((r) => (
              <button key={r} type="button" className={form.reason === r ? "on" : ""} aria-pressed={form.reason === r}
                onClick={() => setForm({ ...form, reason: r })}>{t(r)}</button>
            ))}
          </div>
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
