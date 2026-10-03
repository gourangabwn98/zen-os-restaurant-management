import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getRecipes, saveRecipe, deleteRecipe as deleteRecipeApi, getInventoryItems } from "../../../services/inventoryService.js";
import { getMenu } from "../../../services/menuService.js";
import { getSalesInsights } from "../../../services/adminService.js";
import { daysAgo } from "./invKit.js";
import {
  Modal, TableShell, Toolbar, Search, Seg, Spacer, Count, Loading, ErrorBox,
} from "./invUI.jsx";
import { inp, label } from "./invKit.js";
import {
  UNITS, compatibleUnits, preferredRecipeUnit, ingredientCost, formatMoney, formatUnitCost, formatQty, unitLabel,
} from "../../../utils/units.js";
import { t, tn, N_, fmtNum, localName } from "../../../i18n/core.js";

const SEG = [["All", N_("All")], ["tracked", N_("Tracked")], ["untracked", N_("Not tracked")]];

let uid = 0;
const stockLine  = () => ({ key: ++uid, sourceType: "STOCK",  inventoryItem: "", name: "", quantity: "", unit: "", cost: "" });
const customLine = () => ({ key: ++uid, sourceType: "CUSTOM", inventoryItem: "", name: "", quantity: "", unit: "g", cost: "" });

// Scoped styles — tokens only, so light/dark both work.
if (typeof document !== "undefined" && !document.getElementById("rcp-styles")) {
  const s = document.createElement("style");
  s.id = "rcp-styles";
  s.textContent = `
    .rcp-line { display: grid; grid-template-columns: 112px minmax(0,2fr) minmax(0,0.9fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,0.9fr) 28px; gap: 6px; align-items: center; }
    .rcp-head { font-size: 10.5px; color: var(--text-3); font-weight: 600; letter-spacing: .4px; text-transform: uppercase; padding: 0 2px 4px; }
    .rcp-row { padding: 8px; border: 1px solid var(--edge); border-radius: var(--r-ctl); background: var(--card); }
    .rcp-row.err { border-color: var(--stop-line); }
    .rcp-type { display: flex; border: 1px solid var(--edge); border-radius: var(--r-ctl); overflow: hidden; }
    .rcp-type button { flex: 1; padding: 7px 0; font-size: 11px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; background: var(--card-2); color: var(--text-3); }
    .rcp-type button.on { background: var(--violet-weak); color: var(--accent-ink); }
    .rcp-cell { font-size: 12px; color: var(--text-2); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rcp-cost { font-size: 13px; font-weight: 700; color: var(--text-1); text-align: right; }
    .rcp-msg { font-size: 11px; margin-top: 6px; }
    .rcp-sum { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 10px; margin-top: 16px; padding: 14px; border-radius: var(--r-ctl); border: 1px solid var(--violet-mid); background: var(--violet-weak); }
    .rcp-sum .k { font-size: 11px; color: var(--text-2); }
    .rcp-sum .v { font-size: 15px; font-weight: 700; color: var(--text-1); margin-top: 3px; }
    .rcp-sum .big { font-size: 22px; color: var(--accent-ink); }
    .rcp-lbl { display: none; }
    @media (max-width: 720px) {
      .rcp-line { grid-template-columns: 1fr 1fr; }
      .rcp-line > .rcp-wide { grid-column: 1 / -1; }
      .rcp-head { display: none; }
      .rcp-cell, .rcp-cost { text-align: left; }
      .rcp-lbl { display: inline; color: var(--text-3); font-weight: 400; margin-right: 4px; }
      .rcp-sum { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(s);
}

// Client-side checks mirror inventoryService.saveRecipe; the server is still
// the authority and re-validates everything.
const lineErrors = (lines, stockById) => {
  const errs = new Map();
  const seenStock = new Map();
  const seenCustom = new Map();
  lines.forEach((l) => {
    const e = [];
    const qty = Number(l.quantity);
    if (l.sourceType === "STOCK") {
      if (!l.inventoryItem) e.push(t("Choose a stock item"));
      else if (seenStock.has(l.inventoryItem)) e.push(t("Already in this recipe — combine the lines"));
      else seenStock.set(l.inventoryItem, l.key);
    } else {
      const name = l.name.trim().toLowerCase();
      if (!name) e.push(t("Enter a name"));
      else if (seenCustom.has(name)) e.push(t("Already in this recipe — combine the lines"));
      else if ([...stockById.values()].some((s) => s.status === "Active" && s.name.trim().toLowerCase() === name)) {
        e.push(t("This is a stock item — switch the type to Stock so it's deducted"));
      } else seenCustom.set(name, l.key);
    }
    if (l.quantity === "" || !Number.isFinite(qty)) e.push(t("Enter a quantity"));
    else if (qty <= 0) e.push(t("Quantity must be more than 0"));
    const c = ingredientCost(l, stockById.get(l.inventoryItem));
    if (c.error && !c.costMissing) e.push(c.error);
    if (e.length) errs.set(l.key, e);
  });
  return errs;
};

export default function RecipesTab({ version }) {
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [sold, setSold] = useState(null); // menuItem id → qty sold, last 30 days (Insights rule)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [seg, setSeg] = useState("All");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [menuItemId, setMenuItemId] = useState("");
  const [lines, setLines] = useState([stockLine()]);

  const load = useCallback(async () => {
    try {
      const [rRes, mRes, sRes, iRes] = await Promise.all([
        getRecipes(), getMenu({ ignoreSchedule: true }), getInventoryItems(),
        getSalesInsights({ from: daysAgo(30).toISOString(), to: new Date().toISOString() }).catch(() => null),
      ]);
      setSold(iRes ? new Map((iRes.data?.data?.items || []).filter((r) => r.menuItem).map((r) => [String(r.menuItem), r.qty])) : null);
      setRecipes(rRes.data?.recipes || []);
      setMenuItems(Array.isArray(mRes.data) ? mRes.data : []);
      setStockItems(sRes.data?.items || []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, version]);

  const recipeByMenuItem = useMemo(
    () => new Map(recipes.map((r) => [String(r.menuItem?._id || r.menuItem), r])),
    [recipes],
  );
  const stockById = useMemo(() => new Map(stockItems.map((s) => [s._id, s])), [stockItems]);
  const activeStock = useMemo(() => stockItems.filter((s) => s.status === "Active"), [stockItems]);
  const editingMenu = menuItems.find((m) => m._id === menuItemId);

  const openFor = (menuItem) => {
    setMenuItemId(menuItem._id);
    setShowErrors(false);
    const existing = recipeByMenuItem.get(String(menuItem._id));
    setLines(
      existing?.ingredients?.length
        ? existing.ingredients.map((i) => ({
          key: ++uid,
          sourceType: i.sourceType === "CUSTOM" ? "CUSTOM" : "STOCK",
          inventoryItem: i.inventoryItem?._id || (typeof i.inventoryItem === "string" ? i.inventoryItem : ""),
          name: i.sourceType === "CUSTOM" ? i.name : "",
          quantity: String(i.quantity),
          unit: i.unit,
          cost: i.sourceType === "CUSTOM" && i.cost != null ? String(i.cost) : "",
        }))
        : [stockLine()],
    );
    setShowForm(true);
  };

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
  const setType = (key, sourceType) =>
    updateLine(key, sourceType === "STOCK"
      ? { sourceType, inventoryItem: "", unit: "", cost: "" }
      : { sourceType, inventoryItem: "", unit: "g", name: "" });
  const pickStock = (key, id) => {
    const s = stockById.get(id);
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      // Keep the typed unit if it still converts; otherwise default to the
      // handier smaller unit (Milk stocked in l → recipe in ml).
      const unit = s && l.unit && compatibleUnits(s.unit).includes(l.unit) ? l.unit : preferredRecipeUnit(s?.unit || "");
      return { ...l, inventoryItem: id, unit };
    }));
  };

  // Live costs for every line + the recipe total.
  const costs = useMemo(() => new Map(lines.map((l) => [l.key, ingredientCost(l, stockById.get(l.inventoryItem))])), [lines, stockById]);
  const errors = useMemo(() => lineErrors(lines, stockById), [lines, stockById]);
  const summary = useMemo(() => {
    let total = 0, missing = 0;
    lines.forEach((l) => {
      const c = costs.get(l.key);
      if (c?.cost != null) total += c.cost;
      else missing += 1;
    });
    const price = Number(editingMenu?.price) || 0;
    return {
      total, missing, price,
      margin: price ? price - total : null,
      foodPct: price ? (total / price) * 100 : null,
    };
  }, [lines, costs, editingMenu]);

  const handleSave = async () => {
    setShowErrors(true);
    if (!menuItemId) return toast.error(t("Select a menu item"));
    if (!lines.length) return toast.error(t("Add at least one ingredient"));
    if (errors.size) return toast.error(t("Fix the highlighted ingredients first"));
    setSaving(true);
    try {
      await saveRecipe({
        menuItem: menuItemId,
        ingredients: lines.map((l) => (l.sourceType === "STOCK"
          ? { sourceType: "STOCK", inventoryItem: l.inventoryItem, quantity: Number(l.quantity), unit: l.unit }
          : { sourceType: "CUSTOM", name: l.name.trim(), quantity: Number(l.quantity), unit: l.unit, cost: Number(l.cost) })),
      });
      toast.success(t("Recipe saved · making cost {amount}", { amount: formatMoney(summary.total) }));
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Failed to save recipe")); }
    finally { setSaving(false); }
  };

  const handleDelete = async (recipe) => {
    if (!window.confirm(t("Remove the recipe for \"{name}\"? It will no longer be inventory-tracked.", { name: localName(recipe.menuItem) }))) return;
    try { await deleteRecipeApi(recipe._id); toast.success(t("Recipe removed")); load(); }
    catch { toast.error(t("Failed to remove recipe")); }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems
      .map((mi) => ({ mi, recipe: recipeByMenuItem.get(String(mi._id)) }))
      .filter(({ mi, recipe }) => {
        if (seg === "tracked" && !recipe) return false;
        if (seg === "untracked" && recipe) return false;
        if (q && !mi.name.toLowerCase().includes(q) && !(mi.nameBn || "").toLowerCase().includes(q)) return false;
        return true;
      })
      // Top dishes first (most sold in the last 30 days), then by name.
      .sort((a, b) => (sold?.get(String(b.mi._id)) || 0) - (sold?.get(String(a.mi._id)) || 0) || a.mi.name.localeCompare(b.mi.name));
  }, [menuItems, recipeByMenuItem, search, seg, sold]);

  const trackedCount = recipes.length;

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what={N_("recipes")} />;

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14 }}>
        {t("Menu item → recipe → ingredient → inventory stock. Selling a dish with a recipe deducts its stock ingredients (recipe quantity × quantity sold) when the order goes to the kitchen. Making cost uses each stock item’s current cost price; custom ingredients add their own price but aren’t stock-tracked.")}
      </div>

      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder={t("Search menu items")} />
        <Seg options={SEG} value={seg} onChange={setSeg} ariaLabel={t("Filter by tracking status")} />
        <Spacer />
        <Count>{tn(menuItems.length, "{tracked} of {n} menu item tracked", "{tracked} of {n} menu items tracked", { tracked: trackedCount })}</Count>
      </Toolbar>

      <TableShell
        headers={[N_("Menu item"), N_("Sold (30 days)"), N_("Ingredients"), N_("Price"), N_("Making cost"), N_("Food cost"), N_("Margin / plate"), N_("Status"), ""]}
        minWidth={1000}
        isEmpty={rows.length === 0}
        emptyIcon="🍳"
        emptyText={menuItems.length === 0 ? t("No menu items found") : t("No menu items match these filters")}
      >
        {rows.map(({ mi, recipe }) => {
          const pct = recipe?.foodCostPct;
          return (
            <tr key={mi._id}>
              <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{localName(mi)}</td>
              <td className="num" style={{ color: "var(--text-2)" }}>{sold == null ? "—" : fmtNum(sold.get(String(mi._id)) || 0)}</td>
              <td style={{ color: "var(--text-2)", fontSize: 11.5, maxWidth: 280 }}>
                {recipe?.ingredients?.length
                  ? recipe.ingredients.map((i) => `${localName(i) || i.inventoryItem?.name || "?"} ${formatQty(i.quantity, i.unit)}`).join(", ")
                  : "—"}
              </td>
              <td className="num" style={{ color: "var(--text-2)" }}>{mi.price != null ? formatMoney(mi.price) : "—"}</td>
              <td className="money" title={recipe?.costIncomplete ? t("Some ingredients have no cost price — total is incomplete") : undefined}>
                {recipe ? <>{formatMoney(recipe.makingCost)}{recipe.costIncomplete && <span style={{ color: "var(--wait-ink)" }}> *</span>}</> : "—"}
              </td>
              <td className="num">
                {pct == null ? <span style={{ color: "var(--text-3)" }}>—</span> : <span className={`zc-tag sq ${pct > 45 ? "wait" : "ready"}`}>{fmtNum(pct)}%</span>}
              </td>
              <td className="num" style={{ fontWeight: 700, color: recipe?.grossMargin == null ? "var(--text-3)" : recipe.grossMargin < 0 ? "var(--stop-ink)" : "var(--ready-ink)" }}>
                {recipe?.grossMargin == null ? "—" : formatMoney(recipe.grossMargin)}
              </td>
              <td>
                <span className={`zc-tag ${recipe ? "ready" : "done"}`}><i />{recipe ? t("Tracked") : t("Not tracked")}</span>
              </td>
              <td>
                <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                  <button type="button" className="zc-btn ghost sm" onClick={() => openFor(mi)}>
                    {recipe ? t("Edit recipe") : t("Add recipe")}
                  </button>
                  {recipe && <button type="button" className="zc-btn danger sm" onClick={() => handleDelete(recipe)}>{t("Remove")}</button>}
                </div>
              </td>
            </tr>
          );
        })}
      </TableShell>
      {recipes.some((r) => r.costIncomplete) && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
          <span style={{ color: "var(--wait-ink)" }}>*</span> {t("Incomplete — an ingredient’s stock item has no cost price yet. Set it under Stock Items or record a purchase.")}
        </div>
      )}

      {showForm && (
        <Modal
          title={t("Recipe")}
          sub={editingMenu ? `${localName(editingMenu)}${editingMenu.price != null ? ` · ${t("sells at {price}", { price: formatMoney(editingMenu.price) })}` : ""}` : undefined}
          onClose={() => setShowForm(false)}
          width={880}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>{t("Cancel")}</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? t("Saving…") : t("Save recipe")}
              </button>
            </>
          }
        >
          <label style={label}>{t("Ingredients")} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>— {t("quantities are for ONE serving")}</span></label>

          <div className="rcp-line rcp-head">
            <span>{t("Type")}</span><span>{t("Ingredient")}</span><span>{t("Quantity")}</span><span>{t("Unit")}</span>
            <span style={{ textAlign: "right" }}>{t("Unit cost / price")}</span><span style={{ textAlign: "right" }}>{t("Cost")}</span><span />
          </div>

          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {lines.map((l) => {
              const stock = stockById.get(l.inventoryItem);
              const c = costs.get(l.key);
              const errs = errors.get(l.key);
              const visibleErrs = showErrors || (l.quantity !== "" && (l.inventoryItem || l.name)) ? errs : null;
              const unitOptions = l.sourceType === "STOCK" ? (stock ? compatibleUnits(stock.unit) : []) : UNITS;
              const takenIds = new Set(lines.filter((o) => o.key !== l.key && o.sourceType === "STOCK").map((o) => o.inventoryItem));
              return (
                <div key={l.key} className={`rcp-row${visibleErrs ? " err" : ""}`}>
                  <div className="rcp-line">
                    <div className="rcp-type rcp-wide" role="tablist" aria-label={t("Ingredient type")}>
                      <button type="button" role="tab" aria-selected={l.sourceType === "STOCK"} className={l.sourceType === "STOCK" ? "on" : ""} onClick={() => setType(l.key, "STOCK")}>{t("Stock")}</button>
                      <button type="button" role="tab" aria-selected={l.sourceType === "CUSTOM"} className={l.sourceType === "CUSTOM" ? "on" : ""} onClick={() => setType(l.key, "CUSTOM")}>{t("Custom")}</button>
                    </div>

                    {l.sourceType === "STOCK" ? (
                      <select className="rcp-wide" style={inp} value={l.inventoryItem} onChange={(e) => pickStock(l.key, e.target.value)} aria-label={t("Stock item")}>
                        <option value="">{t("Select stock item…")}</option>
                        {activeStock.map((s) => (
                          <option key={s._id} value={s._id} disabled={takenIds.has(s._id)}>
                            {localName(s)} ({t("{qty} left", { qty: formatQty(s.currentStock, s.unit) })})
                          </option>
                        ))}
                        {stock && stock.status !== "Active" && <option value={stock._id}>{localName(stock)} ({t("inactive")})</option>}
                      </select>
                    ) : (
                      <input className="rcp-wide" style={inp} placeholder={t("e.g. Cardamom")} value={l.name} onChange={(e) => updateLine(l.key, { name: e.target.value })} aria-label={t("Ingredient name")} />
                    )}

                    <input type="number" min="0" step="any" inputMode="decimal" placeholder={t("Qty")} style={inp} value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label={t("Quantity")} />

                    <select style={inp} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label={t("Unit")}
                      disabled={l.sourceType === "STOCK" && !stock}>
                      {l.sourceType === "STOCK" && !stock && <option value="">{t("unit")}</option>}
                      {unitOptions.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                    </select>

                    {l.sourceType === "STOCK" ? (
                      <div className="rcp-cell" title={stock ? t("{price} per {unit}", { price: formatMoney(stock.costPrice), unit: unitLabel(stock.unit) }) : undefined}>
                        <span className="rcp-lbl">{t("Unit cost")}</span>
                        {c?.unitCost != null ? `${formatUnitCost(c.unitCost)}/${unitLabel(l.unit)}` : "—"}
                      </div>
                    ) : (
                      <input type="number" min="0" step="any" inputMode="decimal" placeholder={t("Price ₹")} style={inp} value={l.cost}
                        onChange={(e) => updateLine(l.key, { cost: e.target.value })} aria-label={t("Price for this quantity")} />
                    )}

                    <div className="rcp-cost"><span className="rcp-lbl">{t("Cost")}</span>{c?.cost != null ? formatMoney(c.cost) : "—"}</div>

                    <button type="button" onClick={() => removeLine(l.key)} aria-label={t("Remove ingredient")}
                      style={{ background: "none", border: "none", color: "var(--stop-ink)", cursor: "pointer", fontSize: 15 }}>✕</button>
                  </div>
                  {visibleErrs && <div className="rcp-msg" style={{ color: "var(--stop-ink)" }}>{visibleErrs.join(" · ")}</div>}
                  {!visibleErrs && c?.error && <div className="rcp-msg" style={{ color: "var(--wait-ink)" }}>⚠ {c.error} — {t("set it under Stock Items so the making cost is complete.")}</div>}
                </div>
              );
            })}
            {lines.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: 16, border: "1px dashed var(--edge)", borderRadius: "var(--r-ctl)" }}>
                {t("No ingredients yet — add a stock item or a custom ingredient.")}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="zc-btn ghost sm" onClick={() => setLines((p) => [...p, stockLine()])}>＋ {t("Stock item")}</button>
            <button type="button" className="zc-btn ghost sm" onClick={() => setLines((p) => [...p, customLine()])}>＋ {t("Custom ingredient")}</button>
          </div>

          <div className="rcp-sum" aria-live="polite">
            <div>
              <div className="k">{t("Total making cost")}</div>
              <div className="v big tnum">{formatMoney(summary.total)}</div>
              {summary.missing > 0 && lines.length > 0 && (
                <div className="k" style={{ color: "var(--wait-ink)", marginTop: 2 }}>
                  {tn(summary.missing, "{n} ingredient not costed yet", "{n} ingredients not costed yet")}
                </div>
              )}
            </div>
            <div><div className="k">{t("Selling price")}</div><div className="v tnum">{summary.price ? formatMoney(summary.price) : "—"}</div></div>
            <div>
              <div className="k">{t("Gross margin")}</div>
              <div className="v tnum" style={{ color: summary.margin != null && summary.margin < 0 ? "var(--stop-ink)" : undefined }}>
                {summary.margin != null ? formatMoney(summary.margin) : "—"}
              </div>
            </div>
            <div>
              <div className="k">{t("Food cost")}</div>
              <div className="v tnum">{summary.foodPct != null ? `${fmtNum(Math.round(summary.foodPct * 10) / 10)}%` : "—"}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
            {t("Units convert automatically (Milk stocked in litres can be used in ml). Each sale snapshots this cost, so later price changes don’t rewrite past sales.")}
          </div>
        </Modal>
      )}
    </div>
  );
}
