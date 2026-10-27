import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../shared/PageHeader.jsx";
import { v3Get, v3Write, requestKey, moneyV3 as money } from "../../../services/inventoryV3Service.js";
import { getLegacyManagerWorkspace, saveLegacyManagerItem, adjustLegacyManagerStock } from "../../../services/inventoryManagerService.js";
import { fmtNum, localName, t } from "../../../i18n/core.js";
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
const emptyItem = {
  name: "", nameBn: "", unit: "kg", category: "", currentStock: "0", costPrice: "0",
  reorderLevel: "0", criticalLevel: "0", supplier: "", isBatchTracked: false, notes: "",
};
const SECTIONS = [
  ["overview", "Overview"], ["stock", "Stock"], ["recipes", "Recipes & food cost"],
  ["purchases", "Purchases"], ["wastage", "Wastage"], ["history", "History"], ["suppliers", "Suppliers"],
];
const STATUS_RANK = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2, OK: 3 };
const message = (e) => e?.response?.data?.message || t("Could not save. Please try again.");

function Sheet({ title, children, onClose }) {
  return (
    <div className="im-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="im-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="im-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="im-icon-btn" onClick={onClose} aria-label={t("Close")}><Icon id="close" size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function InventoryManagerPage({ v3Enabled = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [health, setHealth] = useState("");
  const [sort, setSort] = useState("name");
  const [sheet, setSheet] = useState(null);
  const [action, setAction] = useState(null);
  const [section, setSection] = useState("stock");
  const [version, setVersion] = useState(0);
  const sectionRefs = useRef({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const workspace = v3Enabled
        ? await v3Get("mobile", { historyPage: 1, historyLimit: 25 })
        : await getLegacyManagerWorkspace(1);
      setData(workspace);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      if (!background) setLoading(false);
    }
  }, [v3Enabled]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    sectionRefs.current[section]?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [section]);

  const refresh = useCallback(() => {
    load(true);
    setVersion((v) => v + 1);
  }, [load]);

  const openAction = useCallback((kind, item = null, extra = {}) => {
    if (kind === "item" || kind === "edit") {
      setSection("stock");
      setSheet({
        kind: "item",
        form: item ? {
          ...item,
          supplier: item.supplier?._id || item.supplier || "",
          currentStock: String(item.currentStock ?? 0),
          costPrice: String(item.costPrice ?? 0),
          reorderLevel: String(item.reorderLevel ?? 0),
          criticalLevel: String(item.criticalLevel ?? 0),
          isBatchTracked: Boolean(item.isBatchTracked),
          notes: item.notes || "",
        } : emptyItem,
        editing: item || undefined,
      });
      return;
    }
    if (kind === "adjust") {
      setSection("stock");
      setSheet({ kind: "adjust", item, direction: "IN" });
      return;
    }
    setAction({ kind, item, ...extra });
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.items || []).filter((item) => {
      const searchText = `${item.name || ""} ${item.nameBn || ""} ${item.category || ""} ${item.supplier?.name || ""}`.toLowerCase();
      const matchesHealth = !health
        || (health === "OUT" && item.stockLevel === "OUT_OF_STOCK")
        || (health === "CRITICAL" && item.stockLevel === "CRITICAL")
        || (health === "LOW" && item.stockLevel === "LOW")
        || (health === "OK" && item.stockLevel === "OK");
      return (!q || searchText.includes(q)) && (!category || item.category === category) && matchesHealth;
    });
    const compare = {
      name: (a, b) => localName(a).localeCompare(localName(b)),
      status: (a, b) => STATUS_RANK[a.stockLevel] - STATUS_RANK[b.stockLevel] || localName(a).localeCompare(localName(b)),
      value: (a, b) => Number(b.valuePaise || 0) - Number(a.valuePaise || 0),
      updated: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    }[sort];
    return compare ? [...list].sort(compare) : list;
  }, [category, data, health, query, sort]);

  const saveItem = async (form, editing) => {
    if (!form.name.trim() || !form.unit) return toast.error(t("Name and stock unit are required"));
    setBusy(true);
    try {
      const path = editing ? `items/${editing._id}` : "items";
      if (v3Enabled) {
        await v3Write(path, { ...form, name: form.name.trim(), requestKey: requestKey(), ...(editing ? { updatedAt: editing.updatedAt } : {}) }, editing ? "patch" : "post");
      } else {
        await saveLegacyManagerItem(form, editing);
      }
      setSheet(null);
      refresh();
      toast.success(t("Inventory item saved"));
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (item, direction, quantity, reason) => {
    if (!(Number(quantity) > 0) || !reason.trim()) return toast.error(t("Enter a positive quantity and reason"));
    setBusy(true);
    try {
      if (v3Enabled) {
        await v3Write("stock-adjustments", { inventoryItem: item._id, direction, quantity: Number(quantity), reason: reason.trim(), requestKey: requestKey() });
      } else {
        await adjustLegacyManagerStock(item, direction, Number(quantity), reason.trim());
      }
      setSheet(null);
      refresh();
      toast.success(t("Stock updated"));
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  const finishAction = () => { setAction(null); refresh(); };
  const openItem = (id) => openAction("edit", (data?.items || []).find((item) => item._id === id));
  const mapOverviewSection = (key) => setSection(key === "items" ? "stock" : key === "movements" ? "history" : key);

  if (loading && !data) {
    return <div className="im-page"><PageHeader title={t("Inventory")} sub={t("Stock, purchases, wastage and recipes. Every change is written to the stock history.")} /><p role="status" className="im-loading">{t("Loading inventory...")}</p></div>;
  }

  return (
    <div className="im-page">
      <PageHeader
        title={t("Inventory")}
        sub={t("Stock, purchases, wastage and recipes. Every change is written to the stock history.")}
        right={<button className="im-primary" type="button" onClick={() => openAction("item")}><Icon id="plus" size={17} /> {t("Add item")}</button>}
      />

      {error && <div className="im-error" role="alert"><span>{error}</span><button type="button" onClick={() => load()}>{t("Retry")}</button></div>}

      <div className="im-summary" aria-label={t("Inventory summary")}>
        <div><b>{fmtNum(data?.summary?.total)}</b><span>{t("Active items")}</span></div>
        <div className="warn"><b>{fmtNum(data?.summary?.low)}</b><span>{t("Low / critical")}</span></div>
        <div className="danger"><b>{fmtNum(data?.summary?.out)}</b><span>{t("Out of stock")}</span></div>
      </div>

      <div className="im-quick-actions" aria-label={t("Inventory actions")}>
        {[["purchase", "Record purchase", "stock in from a bill", "cart"], ["wastage", "Log wastage", "spoiled, expired, damaged", "bin"], ["count", "Count stock", "what's on the shelf now", "box"], ["item", "Add stock item", "name and unit to start", "plus"]].map(([kind, title, sub, icon]) => (
          <button key={kind} type="button" className="im-action-tile" onClick={() => openAction(kind)}>
            <span className="im-action-icon" aria-hidden="true"><Icon id={icon} size={18} /></span>
            <span><b>{t(title)}</b><small>{t(sub)}</small></span>
          </button>
        ))}
      </div>

      <nav className="im-sections" aria-label={t("Inventory sections")} role="tablist">
        {SECTIONS.map(([key, label]) => (
          <button ref={(node) => { sectionRefs.current[key] = node; }} key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? "on" : ""} onClick={() => setSection(key)}>
            {t(label)}{key === "stock" && data?.summary?.low > 0 && <span>{fmtNum(data.summary.low)}</span>}
          </button>
        ))}
      </nav>

      {section === "overview" && <div className="im-admin-section"><InventoryOverview items={data?.items || []} itemsLoading={false} version={version} open={openAction} openItem={openItem} setSection={mapOverviewSection} /></div>}
      {section === "stock" && <StockSection data={data} items={filteredItems} query={query} setQuery={setQuery} category={category} setCategory={setCategory} health={health} setHealth={setHealth} sort={sort} setSort={setSort} openAction={openAction} setSheet={setSheet} />}
      {section === "recipes" && <div className="im-admin-section"><RecipesTab version={version} /></div>}
      {section === "purchases" && <div className="im-admin-section"><PurchasesTab version={version} open={openAction} allowImport={false} /></div>}
      {section === "wastage" && <div className="im-admin-section"><WastageTab version={version} open={openAction} /></div>}
      {section === "history" && <div className="im-admin-section"><MovementsTab items={data?.items || []} version={version} openItem={openItem} /></div>}
      {section === "suppliers" && <div className="im-admin-section"><SuppliersTab items={data?.items || []} version={version} refresh={refresh} /></div>}

      {action?.kind === "purchase" && <PurchaseModal items={data?.items || []} suppliers={data?.suppliers || []} prefill={action.prefill || (action.item ? [action.item._id] : [])} onClose={() => setAction(null)} onSaved={finishAction} onSupplierAdded={refresh} />}
      {action?.kind === "wastage" && <WastageModal items={data?.items || []} prefillItem={action.item?._id || ""} onClose={() => setAction(null)} onSaved={finishAction} />}
      {action?.kind === "count" && <CountModal items={data?.items || []} only={action.item?._id || null} onClose={() => setAction(null)} onSaved={finishAction} />}
      {sheet?.kind === "item" && <ItemSheet form={sheet.form} editing={sheet.editing} busy={busy} suppliers={data?.suppliers || []} categories={data?.categories || []} onClose={() => setSheet(null)} onSave={saveItem} />}
      {sheet?.kind === "adjust" && <AdjustSheet item={sheet.item} direction={sheet.direction} busy={busy} onClose={() => setSheet(null)} onSave={adjust} />}
    </div>
  );
}

function StockSection({ data, items, query, setQuery, category, setCategory, health, setHealth, sort, setSort, openAction, setSheet }) {
  return (
    <section className="im-stock" aria-label={t("Stock items")}>
      <div className="im-stock-toolbar">
        <div className="im-search"><Icon id="search" size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search item, category or supplier")} aria-label={t("Search stock items")} />{query && <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")}><Icon id="close" size={16} /></button>}</div>
        <select className="im-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Category filter")}><option value="">{t("All categories")}</option>{(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="im-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("Sort stock items")}><option value="name">{t("Sort: Name")}</option><option value="status">{t("Sort: Stock status")}</option><option value="value">{t("Sort: Value")}</option><option value="updated">{t("Sort: Recently updated")}</option></select>
      </div>
      <div className="im-filter-row" role="tablist" aria-label={t("Stock status filter")}>
        {[['', "All"], ["OK", "In stock"], ["LOW", "Low"], ["CRITICAL", "Critical"], ["OUT", "Out of stock"]].map(([key, label]) => <button key={key || "all"} type="button" role="tab" aria-selected={health === key} className={health === key ? "on" : ""} onClick={() => setHealth(key)}>{t(label)}</button>)}
      </div>
      <div className="im-list">
        {items.map((item) => <ItemCard key={item._id} item={item} onEdit={() => openAction("edit", item)} onAdjust={(direction) => setSheet({ kind: "adjust", item, direction })} />)}
        {!items.length && <div className="im-empty"><b>{t("No items found")}</b><span>{t("Try another search or filter.")}</span></div>}
      </div>
    </section>
  );
}

function ItemCard({ item, onEdit, onAdjust }) {
  const level = item.stockLevel || (item.currentStock <= 0 ? "OUT_OF_STOCK" : "OK");
  const levelLabel = { OK: "In stock", LOW: "Low", CRITICAL: "Critical", OUT_OF_STOCK: "Out of stock" }[level];
  const secondaryName = item.nameBn && item.nameBn !== item.name ? item.nameBn : "";
  return (
    <article className={`im-card im-level-${level.toLowerCase()}`}>
      <div className="im-card-top"><div><h3>{localName(item)}</h3>{secondaryName && <span className="im-local-name">{secondaryName}</span>}<span>{item.category || t("Uncategorised")}</span></div><em className={`im-badge ${level.toLowerCase()}`}>{t(levelLabel)}</em></div>
      <div className="im-qty"><b>{fmtNum(item.currentStock)}</b><span>{item.unit}</span><div className="im-thresholds"><small>{t("Reorder")}: {fmtNum(item.reorderLevel)} {item.unit}</small><small>{t("Critical")}: {item.criticalLevel == null ? "-" : `${fmtNum(item.criticalLevel)} ${item.unit}`}</small></div></div>
      <div className="im-card-meta"><span>{t("Cost per unit")}: {money(item.costPaise)}</span><span>{t("Stock value")}: {money(item.valuePaise)}</span>{item.supplierName && <span>{t("Supplier")}: {item.supplierName}</span>}</div>
      <div className="im-card-actions"><button type="button" className="im-in" onClick={() => onAdjust("IN")}>+ {t("Stock in")}</button><button type="button" className="im-out" onClick={() => onAdjust("OUT")}>- {t("Stock out")}</button><button type="button" className="im-edit" onClick={onEdit}>{t("Edit")}</button></div>
    </article>
  );
}

function ItemSheet({ form, editing, busy, suppliers, categories, onClose, onSave }) {
  const [state, setState] = useState(form);
  const set = (key, value) => setState((current) => ({ ...current, [key]: value }));
  return <Sheet title={editing ? t("Edit item") : t("Add inventory item")} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(state, editing); }}>
    <label>{t("Item name")}<input required value={state.name} onChange={(e) => set("name", e.target.value)} /></label>
    <label>{t("Bengali name")}<input lang="bn" value={state.nameBn || ""} onChange={(e) => set("nameBn", e.target.value)} /></label>
    <div className="im-form-grid"><label>{t("Unit")}<select value={state.unit} onChange={(e) => set("unit", e.target.value)}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>{t("Category")}<input list="im-categories" value={state.category || ""} onChange={(e) => set("category", e.target.value)} /><datalist id="im-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label></div>
    <label>{t("Supplier")}<select value={state.supplier || ""} onChange={(e) => set("supplier", e.target.value)}><option value="">{t("No supplier")}</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select></label>
    {!editing && <label>{t("Current stock")}<input type="number" min="0" step="any" value={state.currentStock} onChange={(e) => set("currentStock", e.target.value)} /></label>}
    <div className="im-form-grid"><label>{t("Cost per unit")}<input type="number" min="0" step="any" value={state.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></label><label>{t("Reorder level")}<input type="number" min="0" step="any" value={state.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} /></label></div>
    <label>{t("Critical level")}<input type="number" min="0" step="any" value={state.criticalLevel} onChange={(e) => set("criticalLevel", e.target.value)} /></label>
    <label>{t("Notes")}<textarea value={state.notes || ""} onChange={(e) => set("notes", e.target.value)} rows="2" /></label>
    <label className="im-check"><input type="checkbox" checked={Boolean(state.isBatchTracked)} onChange={(e) => set("isBatchTracked", e.target.checked)} /> {t("Track batches and expiry")}</label>
    <button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving...") : t("Save item")}</button>
  </form></Sheet>;
}

function AdjustSheet({ item, direction, busy, onClose, onSave }) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  return <Sheet title={`${direction === "IN" ? t("Stock in") : t("Stock out")} - ${localName(item)}`} onClose={onClose}><form className="im-form" onSubmit={(e) => { e.preventDefault(); onSave(item, direction, quantity, reason); }}>
    <p className="im-note">{t("Current stock")}: <b>{fmtNum(item.currentStock)} {item.unit}</b></p>
    <label>{t("Quantity")}<input required autoFocus type="number" min="0.000001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /><small>{t("Unit")}: {item.unit}</small></label>
    <label>{t("Reason")}<input required maxLength="200" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === "IN" ? t("Received from supplier") : t("Used or damaged")} /></label>
    <button className="im-primary im-submit" disabled={busy} type="submit">{busy ? t("Saving...") : t("Confirm stock change")}</button>
  </form></Sheet>;
}
