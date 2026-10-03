// src/pages/admin/inventory/StockItemsTab.jsx — Inventory → Stock.
// Rows are GET /admin/inventory/items (shared by the page) with the server's
// computed `stockLevel`. Value = currentStock × costPrice (the formula the
// overview's stockValue uses). The "vs reorder level" bar is display only:
// the marker is the item's own reorderLevel; items without one show no bar.
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { deleteInventoryItem, updateInventoryItem } from "../../../services/inventoryService.js";
import { Loading, ErrorBox, LevelBadge, RowMenu, TableFooter } from "./invUI.jsx";
import { money, itemValue, levelInk, LEVEL_RANK, needsReorder } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";
import { formatQty, unitLabel } from "../../../utils/units.js";

const PER_PAGE = 15;
const LEVELS = [["All", N_("All")], ["OK", N_("Healthy")], ["LOW", N_("Low")], ["CRITICAL", N_("Critical")], ["OUT_OF_STOCK", N_("Out")]];
const SORTS = [["name", N_("Sort: Name")], ["level", N_("Sort: Stock status")], ["value", N_("Sort: Value, high to low")], ["updated", N_("Sort: Recently changed")]];
const BAR = { OK: "var(--ready)", LOW: "var(--wait)", CRITICAL: "var(--wait)", OUT_OF_STOCK: "var(--stop)" };

function LevelBar({ it }) {
  const r = Number(it.reorderLevel) || 0;
  if (!(r > 0)) return <span className="ivt-hint">{t("no reorder level")}</span>;
  const cur = Math.max(0, Number(it.currentStock) || 0);
  const scale = Math.max(cur, r * 2);
  return (
    <div className="ivt-lvl" title={t("{qty} in stock · reorder at {r}", { qty: formatQty(cur, it.unit), r: formatQty(r, it.unit) })}>
      <i style={{ width: `${(cur / scale) * 100}%`, background: BAR[it.stockLevel] }} />
      <span className="mk" style={{ left: `${(r / scale) * 100}%` }} />
    </div>
  );
}

export default function StockItemsTab({ items, itemsLoading, sharedError, refresh, open, openItem, goHistory }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [level, setLevel] = useState("All");
  const [show, setShow] = useState("Active");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);

  const pool = useMemo(() => items.filter((i) => show === "All" || i.status === show), [items, show]);
  const active = useMemo(() => items.filter((i) => i.status === "Active"), [items]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);

  const counts = useMemo(() => {
    const c = { All: pool.length, OK: 0, LOW: 0, CRITICAL: 0, OUT_OF_STOCK: 0 };
    pool.forEach((i) => { c[i.stockLevel] = (c[i.stockLevel] || 0) + 1; });
    return c;
  }, [pool]);

  const strip = useMemo(() => ({
    value: active.reduce((s, i) => s + itemValue(i), 0),
    reorder: active.filter(needsReorder).length,
    out: active.filter((i) => i.stockLevel === "OUT_OF_STOCK").length,
    noCost: active.filter((i) => !(Number(i.costPrice) > 0)).length,
    noReorder: active.filter((i) => !(Number(i.reorderLevel) > 0)).length,
  }), [active]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = pool.filter((i) => {
      if (cat !== "All" && i.category !== cat) return false;
      if (level !== "All" && i.stockLevel !== level) return false;
      if (q && ![i.name, i.nameBn, i.category, i.supplier?.name].some((v) => (v || "").toLowerCase().includes(q))) return false;
      return true;
    });
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      level: (a, b) => LEVEL_RANK[a.stockLevel] - LEVEL_RANK[b.stockLevel] || a.name.localeCompare(b.name),
      value: (a, b) => itemValue(b) - itemValue(a),
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    }[sort];
    return [...list].sort(cmp);
  }, [pool, search, cat, level, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pages);
  const paged = rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const reset = (fn) => (v) => { fn(v); setPage(1); };

  const deactivate = async (it) => {
    if (!window.confirm(t("Deactivate \"{name}\"? History is preserved.", { name: localName(it) }))) return;
    try { await deleteInventoryItem(it._id); toast.success(t("Item deactivated")); refresh(); }
    catch { toast.error(t("Failed to deactivate")); }
  };
  const reactivate = async (it) => {
    try { await updateInventoryItem(it._id, { status: "Active" }); toast.success(t("Item reactivated")); refresh(); }
    catch { toast.error(t("Failed to update")); }
  };

  const menu = (it) => (it.status === "Active" ? [
    { label: t("Add stock (purchase)"), onClick: () => open("purchase", it) },
    { label: t("Adjust stock"), onClick: () => open("adjust", it) },
    { label: t("Log wastage"), onClick: () => open("wastage", it) },
    "-",
    { label: t("Edit item"), onClick: () => open("edit", it) },
    { label: t("Stock history"), onClick: () => goHistory(it._id) },
    "-",
    { label: t("Deactivate"), onClick: () => deactivate(it), danger: true },
  ] : [
    { label: t("Stock history"), onClick: () => goHistory(it._id) },
    { label: t("Reactivate"), onClick: () => reactivate(it) },
  ]);

  if (itemsLoading) return <Loading />;
  if (sharedError && items.length === 0) return <ErrorBox onRetry={refresh} what={N_("stock items")} />;

  const filtersOn = search || cat !== "All" || level !== "All";

  return (
    <>
      <div className="zc-card ivt-strip" style={{ "--n": 5 }}>
        <div><div className="k">{t("Stock items")}</div><div className="v">{fmtNum(active.length)}</div><div className="d">{tn(categories.length, "{n} category", "{n} categories")}</div></div>
        <div><div className="k">{t("Stock value")}</div><div className="v">{money(strip.value)}</div><div className="d">{t("at current cost prices")}</div></div>
        <div>
          <div className="k">{t("Needs reorder")}</div>
          <button type="button" className="v" style={{ color: strip.reorder ? "var(--wait-ink)" : "var(--ready-ink)" }}
            onClick={() => { setLevel("All"); setSort("level"); setPage(1); }}>{fmtNum(strip.reorder)}</button>
          <div className="d">{t("at or below reorder level")}</div>
        </div>
        <div>
          <div className="k">{t("Out of stock")}</div>
          <button type="button" className="v" style={{ color: strip.out ? "var(--stop-ink)" : "var(--text-1)" }}
            onClick={() => { setLevel("OUT_OF_STOCK"); setPage(1); }}>{fmtNum(strip.out)}</button>
          <div className="d">{t("0 left")}</div>
        </div>
        <div><div className="k">{t("No cost price")}</div><div className="v" style={strip.noCost ? { color: "var(--wait-ink)" } : undefined}>{fmtNum(strip.noCost)}</div><div className="d">{t("left out of stock value")}</div></div>
      </div>

      <div className="ivt-fbar">
        <input className="zc-input search" type="search" value={search} onChange={(e) => reset(setSearch)(e.target.value)}
          placeholder={t("Search item, category or supplier")} aria-label={t("Search stock items")} />
        <select className="zc-select" value={cat} onChange={(e) => reset(setCat)(e.target.value)} aria-label={t("Category filter")}>
          <option value="All">{t("Category: All")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="zc-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("Sort")}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        <select className="zc-select" value={show} onChange={(e) => reset(setShow)(e.target.value)} aria-label={t("Show items")}>
          <option value="Active">{t("Active items")}</option>
          <option value="Inactive">{t("Inactive items")}</option>
          <option value="All">{t("All items")}</option>
        </select>
        <span className="ivt-sp" />
        <button type="button" className="zc-btn" onClick={() => open("count")}>{t("Count stock")}</button>
        <button type="button" className="zc-btn pri" onClick={() => open("item")}>＋ {t("Add stock item")}</button>
      </div>
      <div className="ivt-fbar">
        <div className="zc-seg" role="tablist" aria-label={t("Stock status filter")}>
          {LEVELS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={level === k} className={level === k ? "on" : ""} onClick={() => reset(setLevel)(k)}>
              {t(l)}<span className="ivt-seg-n">{fmtNum(counts[k] || 0)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="zc-card">
        {rows.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? t("No stock items yet — add one to start tracking") : t("No items match these filters")}
            action={items.length === 0
              ? <button type="button" className="zc-btn pri" onClick={() => open("item")}>＋ {t("Add stock item")}</button>
              : filtersOn ? <button type="button" className="zc-btn" onClick={() => { setSearch(""); setCat("All"); setLevel("All"); }}>{t("Clear filters")}</button> : null}
          />
        ) : (
          <>
            <div className="ivt-tablewrap">
              <table className="zc-ledger" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>{t("Item")}</th><th>{t("Category")}</th><th>{t("Left now")}</th><th style={{ width: 150 }}>{t("vs reorder level")}</th>
                    <th className="num">{t("Cost")}</th><th className="num">{t("Value")}</th><th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((it) => (
                    <tr key={it._id} className={`ivt-click${["OUT_OF_STOCK", "CRITICAL"].includes(it.stockLevel) && it.status === "Active" ? " ivt-hl" : ""}`} onClick={() => openItem(it._id)}>
                      <td>
                        <div className="ivt-name">
                          <b>{localName(it)}{it.status !== "Active" && <span className="ivt-hint" style={{ marginLeft: 6, fontWeight: 400 }}>({t("inactive")})</span>}</b>
                          {it.supplier?.name && <small>{it.supplier.name}</small>}
                        </div>
                      </td>
                      <td>{it.category ? <span className="zc-tag done sq">{it.category}</span> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td className="nw">
                        <span className="ivt-qty" style={{ color: levelInk(it.stockLevel) }}>{formatQty(it.currentStock, it.unit)}</span>
                        <LevelBadge level={it.stockLevel} />
                      </td>
                      <td><LevelBar it={it} /></td>
                      <td className="num" style={{ color: it.costPrice ? "var(--text-2)" : "var(--wait-ink)" }}>
                        {it.costPrice ? `${money(it.costPrice)}/${unitLabel(it.unit)}` : t("Not set")}
                      </td>
                      <td className="money">{money(itemValue(it))}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="ivt-acts">
                          {it.status === "Active" && <button type="button" className="zc-btn ghost sm" onClick={() => open("count", it)}>{t("Count")}</button>}
                          <RowMenu items={menu(it)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ivt-cards">
              {paged.map((it) => (
                <div key={it._id} className={`ivt-ocard click${["OUT_OF_STOCK", "CRITICAL"].includes(it.stockLevel) && it.status === "Active" ? " hl" : ""}`} onClick={() => openItem(it._id)}>
                  <div className="top">
                    <div className="ivt-name" style={{ minWidth: 0 }}>
                      <b>{localName(it)}{it.status !== "Active" && <span className="ivt-hint" style={{ marginLeft: 6, fontWeight: 400 }}>({t("inactive")})</span>}</b>
                      <small>{[it.category, it.supplier?.name].filter(Boolean).join(" · ") || t("Uncategorised")}</small>
                    </div>
                    <div style={{ textAlign: "right", flex: "none" }}>
                      <div className="ivt-qty" style={{ color: levelInk(it.stockLevel), marginRight: 0 }}>{formatQty(it.currentStock, it.unit)}</div>
                      <div className="ivt-hint">{money(itemValue(it))}</div>
                    </div>
                  </div>
                  <LevelBar it={it} />
                  <div className="meta">
                    <LevelBadge level={it.stockLevel} />
                    <span className="ivt-hint">{it.costPrice ? `${money(it.costPrice)}/${unitLabel(it.unit)}` : t("No cost price")}</span>
                    <div className="ivt-acts" style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                      {it.status === "Active" && <button type="button" className="zc-btn ghost sm" onClick={() => open("count", it)}>{t("Count")}</button>}
                      <RowMenu items={menu(it)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="ivt-tfoot">
              <span>
                {tn(pool.length, "{shown} of {n} item", "{shown} of {n} items", { shown: rows.length })}
                {strip.noReorder > 0 && ` · ${tn(strip.noReorder, "{n} item has no reorder level, so it never shows as low", "{n} items have no reorder level, so they never show as low")}`}
              </span>
              <TableFooter page={safePage} pages={pages} total={rows.length} perPage={PER_PAGE} onPage={setPage} unit={N_("items")} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
