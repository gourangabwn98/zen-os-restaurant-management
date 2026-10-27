import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../shared/PageHeader.jsx";
import { v3Get, v3Write, requestKey, moneyV3 as money } from "../../../services/inventoryV3Service.js";
import { getLegacyManagerWorkspace, saveLegacyManagerItem, adjustLegacyManagerStock } from "../../../services/inventoryManagerService.js";
import { fmtNum, t } from "../../../i18n/core.js";
import InventoryOverview from "../inventory/InventoryOverview.jsx";
import PurchasesTab from "../inventory/PurchasesTab.jsx";
import WastageTab from "../inventory/WastageTab.jsx";
import RecipesTab from "../inventory/RecipesTab.jsx";
import MovementsTab from "../inventory/MovementsTab.jsx";
import SuppliersTab from "../inventory/SuppliersTab.jsx";
import { PurchaseModal, WastageModal, CountModal } from "../inventory/EntryModals.jsx";
import { Icon } from "../inventory/invUI.jsx";
import "./inventory-manager.css";

const UNITS = ["kg", "g", "l", "ml", "pcs", "packet", "dozen", "box"];
const emptyItem = { name: "", unit: "kg", category: "", currentStock: "0", costPrice: "0", reorderLevel: "0", usualStockQty: "", supplier: "" };
const SECTIONS = [
  ["overview", "Overview"], ["stock", "Stock"], ["recipes", "Recipes & food cost"],
  ["purchases", "Purchases"], ["wastage", "Wastage"], ["history", "History"], ["suppliers", "Suppliers"],
];
const message = (e) => e?.response?.data?.message || t("Could not save. Please try again.");

function Sheet({ title, children, onClose }) {
  return <div className="im-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="im-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="im-sheet-head"><h2>{title}</h2><button type="button" className="im-icon-btn" onClick={onClose} aria-label={t("Close")}>X</button></div>
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
  const [sheet, setSheet] = useState(null);
  const [action, setAction] = useState(null);
  const [section, setSection] = useState("overview");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      setData(v3Enabled ? await v3Get("mobile", { historyPage: 1, historyLimit: 25 }) : await getLegacyManagerWorkspace(1));
      setError("");
    } catch (e) { setError(message(e)); }
    finally { if (!background) setLoading(false); }
  }, [v3Enabled]);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { load(true); setVersion((v) => v + 1); }, [load]);
  const openAction = useCallback((kind, item = null) => {
    if (kind === "item" || kind === "edit") {
      setSection("stock");
      setSheet({ kind: "item", form: item ? { ...item, supplier: item.supplier?._id || item.supplier || "", currentStock: String(item.currentStock), costPrice: String(item.costPrice), reorderLevel: String(item.reorderLevel) } : emptyItem, editing: item || undefined });
      return;
    }
    if (kind === "adjust") { setSection("stock"); setSheet({ kind: "adjust", item, direction: "IN" }); return; }
    if (kind === "import") return toast.error(t("Bill import is available to Admin users"));
    setAction({ kind, item });
  }, []);

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
      setSheet(null); refresh(); toast.success(t("Inventory item saved"));
    } catch (e) { toast.error(message(e)); }
    finally { setBusy(false); }
  };

  const adjust = async (item, direction, quantity, reason) => {
    if (!(Number(quantity) > 0) || !reason.trim()) return toast.error(t("Enter a positive quantity and reason"));
    setBusy(true);
    try {
      if (v3Enabled) await v3Write("stock-adjustments", { inventoryItem: item._id, direction, quantity: Number(quantity), reason: reason.trim(), requestKey: requestKey() });
      else await adjustLegacyManagerStock(item, direction, Number(quantity), reason.trim());
      setSheet(null); refresh(); toast.success(t("Stock updated"));
    } catch (e) { toast.error(message(e)); }
    finally { setBusy(false); }
  };

  const finishAction = () => { setAction(null); refresh(); };
  const openItem = (id) => openAction("edit", (data?.items || []).find((item) => item._id === id));

  if (loading && !data) return <div className="im-page"><PageHeader title={t("Inventory")} sub={t("Stock, purchases, wastage and recipes. Every change is written to the stock history.")} /><p role="status" className="im-loading">{t("Loading inventory...")}</p></div>;

  return <div className="im-page">
    <PageHeader title={t("Inventory")} sub={t("Stock, purchases, wastage and recipes. Every change is written to the stock history.")} right={<button className="im-primary" type="button" onClick={() => openAction("item")}>+ {t("Add item")}</button>} />
    {error && <div className="im-error" role="alert">{error}<button type="button" onClick={() => load()}>{t("Retry")}</button></div>}
    <div className="im-summary" aria-label={t("Inventory summary")}>
      <div><b>{fmtNum(data?.summary?.total)}</b><span>{t("Items")}</span></div><div className="warn"><b>{fmtNum(data?.summary?.low)}</b><span>{t("Low stock")}</span></div><div className="danger"><b>{fmtNum(data?.summary?.out)}</b><span>{t("Out of stock")}</span></div>
    </div>
    <div className="im-quick-actions" aria-label={t("Inventory actions")}>
      {[["purchase", "Record purchase", "stock in from a bill", "cart"], ["wastage", "Log wastage", "spoiled, expired, damaged", "bin"], ["count", "Count stock", "what's on the shelf now", "box"], ["import", "Import a bill", "read a PDF or photo", "cam"], ["item", "Add stock item", "name and unit to start", "plus"]].map(([kind, title, sub, icon]) => <button key={kind} type="button" className={`im-action-tile ${kind === "import" ? "is-restricted" : ""}`} onClick={() => openAction(kind)}><span className="im-action-icon" aria-hidden="true"><Icon id={icon} size={18} /></span><span><b>{t(title)}</b><small>{t(sub)}</small>{kind === "import" && <em>{t("Admin only")}</em>}</span></button>)}
    </div>
    <nav className="im-sections" aria-label={t("Inventory sections")} role="tablist">{SECTIONS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? "on" : ""} onClick={() => setSection(key)}>{t(label)}{key === "stock" && data?.summary?.low > 0 && <span>{fmtNum(data.summary.low)}</span>}</button>)}</nav>

    {section === "overview" && <div className="im-admin-section"><InventoryOverview items={data?.items || []} itemsLoading={false} version={version} open={openAction} openItem={openItem} setSection={setSection} onNavigate={() => {}} /></div>}
    {section === "stock" && <><div className="im-search-row"><div className="im-search"><span aria-hidden="true">?</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search inventory")} aria-label={t("Search inventory")} />{query && <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")}>X</button>}</div><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Category")}><option value="">{t("All categories")}</option>{(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select></div><div className="im-filter-row">{[["", t("All")], ["LOW", t("Low stock")], ["OUT", t("Out of stock")], ["OK", t("In stock")]].map(([key, label]) => <button key={key || "all"} type="button" className={health === key ? "on" : ""} onClick={() => setHealth(key)}>{label}</button>)}</div><div className="im-list">{items.map((item) => <ItemCard key={item._id} item={item} onEdit={() => openAction("edit", item)} onAdjust={(direction) => setSheet({ kind: "adjust", item, direction })} />)}{!items.length && <div className="im-empty"><b>{t("No items found")}</b><span>{t("Try another search or category.")}</span></div>}</div></>}
    {section === "recipes" && <div className="im-admin-section"><RecipesTab version={version} /></div>}
    {section === "purchases" && <div className="im-admin-section"><PurchasesTab version={version} open={openAction} /></div>}
    {section === "wastage" && <div className="im-admin-section"><WastageTab version={version} open={openAction} /></div>}
    {section === "history" && <div className="im-admin-section"><MovementsTab items={data?.items || []} version={version} openItem={openItem} /></div>}
    {section === "suppliers" && <div className="im-admin-section"><SuppliersTab items={data?.items || []} version={version} refresh={refresh} /></div>}

    {action?.kind === "purchase" && <PurchaseModal items={data?.items || []} suppliers={data?.suppliers || []} onClose={() => setAction(null)} onSaved={finishAction} onImport={() => { setAction(null); openAction("import"); }} onSupplierAdded={refresh} />}
    {action?.kind === "wastage" && <WastageModal items={data?.items || []} prefillItem={action.item?._id || ""} onClose={() => setAction(null)} onSaved={finishAction} />}
    {action?.kind === "count" && <CountModal items={data?.items || []} only={action.item?._id || null} onClose={() => setAction(null)} onSaved={finishAction} />}
    {sheet?.kind === "item" && <ItemSheet form={sheet.form} editing={sheet.editing} busy={busy} suppliers={data?.suppliers || []} onClose={() => setSheet(null)} onSave={saveItem} />}
    {sheet?.kind === "adjust" && <AdjustSheet item={sheet.item} direction={sheet.direction} busy={busy} onClose={() => setSheet(null)} onSave={adjust} />}
  </div>;
}

function ItemCard({ item, onEdit, onAdjust }) {
  const level = item.currentStock <= 0 ? "OUT" : item.stockLevel !== "OK" ? "LOW" : "OK";
  return <article className="im-card"><div className="im-card-top"><div><h3>{item.name}</h3><span>{item.category || t("Uncategorised")}</span></div><em className={`im-badge ${level.toLowerCase()}`}>{level === "OUT" ? t("Out of stock") : level === "LOW" ? t("Low stock") : t("In stock")}</em></div><div className="im-qty"><b>{fmtNum(item.currentStock)}</b><span>{item.unit}</span><small>{t("Reorder at")} {fmtNum(item.reorderLevel)} {item.unit}</small></div><div className="im-card-meta"><span>{t("Cost per unit")}: {money(item.costPaise)}</span><span>{t("Stock value")}: {money(item.valuePaise)}</span>{item.supplierName && <span>{t("Supplier")}: {item.supplierName}</span>}</div><div className="im-card-actions"><button type="button" className="im-in" onClick={() => onAdjust("IN")}>+ {t("Stock in")}</button><button type="button" className="im-out" onClick={() => onAdjust("OUT")}>- {t("Stock out")}</button><button type="button" className="im-edit" onClick={onEdit}>{t("Edit")}</button></div></article>;
}

function ItemSheet({ form, editing, busy, suppliers, onClose, onSave }) {
  const [state, setState] = useState(form); const set = (k, v) => setState((s) => ({ ...s, [k]: v }));
  return <Sheet title={editing ? t("Edit item") : t("Add inventory item")} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(state, editing); }}><label>{t("Name")}<input required value={state.name} onChange={(e) => set("name", e.target.value)} /></label><label>{t("Unit")}<select value={state.unit} onChange={(e) => set("unit", e.target.value)}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>{t("Category")}<input value={state.category} onChange={(e) => set("category", e.target.value)} /></label><label>{t("Supplier")}<select value={state.supplier || ""} onChange={(e) => set("supplier", e.target.value)}><option value="">{t("No supplier")}</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select></label>{!editing && <label>{t("Current stock")}<input type="number" min="0" step="any" value={state.currentStock} onChange={(e) => set("currentStock", e.target.value)} /></label>}<label>{t("Cost per unit")}<input type="number" min="0" step="any" value={state.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></label><label>{t("Reorder level")}<input type="number" min="0" step="any" value={state.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} /></label><button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving...") : t("Save item")}</button></form></Sheet>;
}

function AdjustSheet({ item, direction, busy, onClose, onSave }) {
  const [quantity, setQuantity] = useState(""); const [reason, setReason] = useState("");
  return <Sheet title={`${direction === "IN" ? t("Stock in") : t("Stock out")} - ${item.name}`} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(item, direction, quantity, reason); }}><p className="im-note">{t("Current stock")}: <b>{fmtNum(item.currentStock)} {item.unit}</b></p><label>{t("Quantity")}<input required autoFocus type="number" min="0.000001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label><label>{t("Reason")}<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === "IN" ? t("Received from supplier") : t("Used or damaged")} /></label><button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving...") : t("Confirm stock change")}</button></form></Sheet>;
}
