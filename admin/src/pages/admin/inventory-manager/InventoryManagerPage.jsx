import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../shared/PageHeader.jsx";
import { v3Get, v3Write, requestKey, moneyV3 as money } from "../../../services/inventoryV3Service.js";
import { getLegacyManagerWorkspace, saveLegacyManagerItem, adjustLegacyManagerStock } from "../../../services/inventoryManagerService.js";
import { fmtDateTime, fmtNum, t } from "../../../i18n/core.js";
import "./inventory-manager.css";

const UNITS = ["kg", "g", "l", "ml", "pcs", "packet", "dozen", "box"];
const emptyItem = { name: "", unit: "kg", category: "", currentStock: "0", costPrice: "0", reorderLevel: "0", usualStockQty: "", supplier: "" };
const message = (e) => e?.response?.data?.message || t("Could not save. Please try again.");

function Sheet({ title, children, onClose }) {
  return <div className="im-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="im-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="im-sheet-head"><h2>{title}</h2><button type="button" className="im-icon-btn" onClick={onClose} aria-label={t("Close")}>×</button></div>
      {children}
    </section>
  </div>;
}

export default function InventoryManagerPage({ v3Enabled = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [health, setHealth] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try { setData(v3Enabled ? await v3Get("mobile", { historyPage, historyLimit: 25 }) : await getLegacyManagerWorkspace(historyPage)); setError(""); }
    catch (e) { setError(message(e)); }
    finally { if (!background) setLoading(false); }
  }, [historyPage, v3Enabled]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (data?.items || []).filter((item) => {
    const q = query.trim().toLowerCase();
    const matchesText = !q || `${item.name} ${item.category}`.toLowerCase().includes(q);
    const matchesCategory = !category || item.category === category;
    const matchesHealth = !health || (health === "OUT" ? item.currentStock <= 0 : health === "LOW" ? item.currentStock > 0 && item.stockLevel !== "OK" : item.stockLevel === "OK");
    return matchesText && matchesCategory && matchesHealth;
  }), [data, query, category, health]);

  const saveItem = async (form, editing) => {
    if (!form.name.trim() || !form.unit) return toast.error(t("Name and stock unit are required"));
    setBusy(true);
    try {
      const path = editing ? `items/${editing._id}` : "items";
      if (v3Enabled) await v3Write(path, { ...form, name: form.name.trim(), requestKey: requestKey(), ...(editing ? { updatedAt: editing.updatedAt } : {}) }, editing ? "patch" : "post");
      else await saveLegacyManagerItem(form, editing);
      setSheet(null); await load(true); toast.success(t("Inventory item saved"));
    } catch (e) { toast.error(message(e)); }
    finally { setBusy(false); }
  };
  const adjust = async (item, direction, quantity, reason) => {
    if (!(Number(quantity) > 0) || !reason.trim()) return toast.error(t("Enter a positive quantity and reason"));
    setBusy(true);
    try {
      if (v3Enabled) await v3Write("stock-adjustments", { inventoryItem: item._id, direction, quantity: Number(quantity), reason: reason.trim(), requestKey: requestKey() });
      else await adjustLegacyManagerStock(item, direction, Number(quantity), reason.trim());
      setSheet(null); await load(true); toast.success(t("Stock updated"));
    } catch (e) { toast.error(message(e)); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="im-page"><PageHeader title={t("Inventory")} sub={t("Stock at a glance")} /><p role="status" className="im-loading">{t("Loading inventory…")}</p></div>;
  return <div className="im-page">
    <PageHeader title={t("Inventory")} sub={t("Stock at a glance")} right={<button className="im-primary" type="button" onClick={() => setSheet({ kind: "item", form: emptyItem })}>+ {t("Add item")}</button>} />
    {error && <div className="im-error" role="alert">{error}<button type="button" onClick={() => load()}>{t("Retry")}</button></div>}
    <div className="im-summary" aria-label={t("Inventory summary")}>
      <div><b>{fmtNum(data?.summary?.total)}</b><span>{t("Items")}</span></div><div className="warn"><b>{fmtNum(data?.summary?.low)}</b><span>{t("Low stock")}</span></div><div className="danger"><b>{fmtNum(data?.summary?.out)}</b><span>{t("Out of stock")}</span></div>
    </div>
    <div className="im-search-row"><div className="im-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search inventory")} aria-label={t("Search inventory")} />{query && <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")}>×</button>}</div><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Category")}><option value="">{t("All categories")}</option>{(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
    <div className="im-filter-row">{[["", t("All")], ["LOW", t("Low stock")], ["OUT", t("Out of stock")], ["OK", t("In stock")]].map(([key, label]) => <button key={key || "all"} type="button" className={health === key ? "on" : ""} onClick={() => setHealth(key)}>{label}</button>)}</div>
    <div className="im-list">{items.map((item) => <ItemCard key={item._id} item={item} onEdit={() => setSheet({ kind: "item", form: { ...item, supplier: item.supplier?._id || item.supplier || "", currentStock: String(item.currentStock), costPrice: String(item.costPrice), reorderLevel: String(item.reorderLevel), usualStockQty: item.config?.usualStockQty || "" }, editing: item })} onAdjust={(direction) => setSheet({ kind: "adjust", item, direction })} />)}{!items.length && <div className="im-empty"><b>{t("No items found")}</b><span>{t("Try another search or category.")}</span></div>}</div>
    <section className="im-history"><h2>{t("Stock history")}</h2>{(data?.movements || []).map((move) => { const before = Number(move.balanceAfter) - Number(move.quantity); return <div className="im-history-row" key={move._id}><div><b>{move.itemName}</b><span>{move.reason || t("Stock movement")}</span><small>{fmtNum(before)} {move.unit} → {fmtNum(move.balanceAfter)} {move.unit}</small></div><strong className={move.quantity < 0 ? "minus" : "plus"}>{move.quantity > 0 ? "+" : ""}{fmtNum(move.quantity)} {move.unit}</strong><time>{fmtDateTime(move.createdAt)} · {move.createdBy?.name || t("System")}</time></div>; })}{!data?.movements?.length && <p className="im-muted">{t("No stock movements yet.")}</p>}<div className="im-history-pager"><button type="button" disabled={(data?.movementMeta?.page || 1) <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}>{t("Previous")}</button><span>{t("Page {page} of {pages}", { page: data?.movementMeta?.page || 1, pages: data?.movementMeta?.pages || 1 })}</span><button type="button" disabled={(data?.movementMeta?.page || 1) >= (data?.movementMeta?.pages || 1)} onClick={() => setHistoryPage((p) => p + 1)}>{t("Next")}</button></div></section>
    {sheet?.kind === "item" && <ItemSheet form={sheet.form} editing={sheet.editing} busy={busy} suppliers={data?.suppliers || []} onClose={() => setSheet(null)} onSave={saveItem} />}
    {sheet?.kind === "adjust" && <AdjustSheet item={sheet.item} direction={sheet.direction} busy={busy} onClose={() => setSheet(null)} onSave={adjust} />}
  </div>;
}

function ItemCard({ item, onEdit, onAdjust }) {
  const level = item.currentStock <= 0 ? "OUT" : item.stockLevel !== "OK" ? "LOW" : "OK";
  return <article className="im-card"><div className="im-card-top"><div><h3>{item.name}</h3><span>{item.category || t("Uncategorised")}</span></div><em className={`im-badge ${level.toLowerCase()}`}>{level === "OUT" ? t("Out of stock") : level === "LOW" ? t("Low stock") : t("In stock")}</em></div><div className="im-qty"><b>{fmtNum(item.currentStock)}</b><span>{item.unit}</span><small>{t("Reorder at")} {fmtNum(item.reorderLevel)} {item.unit}</small></div><div className="im-card-meta"><span>{t("Cost per unit")}: {money(item.costPaise)}</span><span>{t("Stock value")}: {money(item.valuePaise)}</span>{item.supplierName && <span>{t("Supplier")}: {item.supplierName}</span>}</div><div className="im-card-actions"><button type="button" className="im-in" onClick={() => onAdjust("IN")}>+ {t("Stock in")}</button><button type="button" className="im-out" onClick={() => onAdjust("OUT")}>− {t("Stock out")}</button><button type="button" className="im-edit" onClick={onEdit}>{t("Edit")}</button></div></article>;
}

function ItemSheet({ form, editing, busy, suppliers, onClose, onSave }) {
  const [state, setState] = useState(form); const set = (k, v) => setState((s) => ({ ...s, [k]: v }));
  return <Sheet title={editing ? t("Edit item") : t("Add inventory item")} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(state, editing); }}><label>{t("Name")}<input required value={state.name} onChange={(e) => set("name", e.target.value)} /></label><label>{t("Unit")}<select value={state.unit} onChange={(e) => set("unit", e.target.value)}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>{t("Category")}<input value={state.category} onChange={(e) => set("category", e.target.value)} /></label><label>{t("Supplier")}<select value={state.supplier || ""} onChange={(e) => set("supplier", e.target.value)}><option value="">{t("No supplier")}</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select></label>{!editing && <label>{t("Current stock")}<input type="number" min="0" step="any" value={state.currentStock} onChange={(e) => set("currentStock", e.target.value)} /></label>}<label>{t("Cost per unit")}<input type="number" min="0" step="any" value={state.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></label><label>{t("Reorder level")}<input type="number" min="0" step="any" value={state.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} /></label><button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving…") : t("Save item")}</button></form></Sheet>;
}

function AdjustSheet({ item, direction, busy, onClose, onSave }) {
  const [quantity, setQuantity] = useState(""); const [reason, setReason] = useState("");
  return <Sheet title={`${direction === "IN" ? t("Stock in") : t("Stock out")} · ${item.name}`} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(item, direction, quantity, reason); }}><p className="im-note">{t("Current stock")}: <b>{fmtNum(item.currentStock)} {item.unit}</b></p><label>{t("Quantity")}<input required autoFocus type="number" min="0.000001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label><label>{t("Reason")}<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === "IN" ? t("Received from supplier") : t("Used or damaged")} /></label><button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving…") : t("Confirm stock change")}</button></form></Sheet>;
}
