import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getRecipes, saveRecipe, deleteRecipe as deleteRecipeApi, getInventoryItems } from "../../../services/inventoryService.js";
import { getMenu } from "../../../services/menuService.js";
import {
  Modal, TableShell, Toolbar, Search, Seg, Spacer, Count, Loading, ErrorBox,
} from "./invUI.jsx";
import { inp, label, num } from "./invKit.js";

const emptyLine = () => ({ inventoryItem: "", quantity: "", unit: "" });
const SEG = [["All", "All"], ["tracked", "Tracked"], ["untracked", "Not tracked"]];

export default function RecipesTab() {
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [seg, setSeg] = useState("All");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuItemId, setMenuItemId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);

  const load = useCallback(async () => {
    try {
      const [rRes, mRes, sRes] = await Promise.all([getRecipes(), getMenu(), getInventoryItems()]);
      setRecipes(rRes.data?.recipes || []);
      setMenuItems(Array.isArray(mRes.data) ? mRes.data : []);
      setStockItems(sRes.data?.items || []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const recipeByMenuItem = useMemo(
    () => new Map(recipes.map((r) => [String(r.menuItem?._id || r.menuItem), r])),
    [recipes],
  );

  const openFor = (menuItem) => {
    setMenuItemId(menuItem._id);
    const existing = recipeByMenuItem.get(String(menuItem._id));
    setLines(
      existing?.ingredients?.length
        ? existing.ingredients.map((i) => ({ inventoryItem: i.inventoryItem?._id || i.inventoryItem, quantity: i.quantity, unit: i.unit }))
        : [emptyLine()],
    );
    setShowForm(true);
  };

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const pickInventoryItem = (idx, id) => {
    const stockItem = stockItems.find((i) => i._id === id);
    updateLine(idx, { inventoryItem: id, unit: stockItem?.unit || "" });
  };

  const handleSave = async () => {
    const validLines = lines.filter((l) => l.inventoryItem && Number(l.quantity) > 0);
    if (!menuItemId) return toast.error("Select a menu item");
    if (!validLines.length) return toast.error("Add at least one ingredient");
    setSaving(true);
    try {
      await saveRecipe({
        menuItem: menuItemId,
        ingredients: validLines.map((l) => ({ inventoryItem: l.inventoryItem, quantity: Number(l.quantity), unit: l.unit })),
      });
      toast.success("Recipe saved");
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Failed to save recipe"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (recipe) => {
    if (!window.confirm(`Remove the recipe for "${recipe.menuItem?.name}"? It will no longer be inventory-tracked.`)) return;
    try { await deleteRecipeApi(recipe._id); toast.success("Recipe removed"); load(); }
    catch { toast.error("Failed to remove recipe"); }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems
      .map((mi) => ({ mi, recipe: recipeByMenuItem.get(String(mi._id)) }))
      .filter(({ mi, recipe }) => {
        if (seg === "tracked" && !recipe) return false;
        if (seg === "untracked" && recipe) return false;
        if (q && !mi.name.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [menuItems, recipeByMenuItem, search, seg]);

  const trackedCount = recipes.length;

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what="recipes" />;

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14 }}>
        Menu item → recipe → ingredient → inventory stock. Selling a dish with a recipe depletes stock automatically.
        Menu items with no recipe are simply not inventory-tracked.
      </div>

      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder="Search menu items" />
        <Seg options={SEG} value={seg} onChange={setSeg} ariaLabel="Filter by tracking status" />
        <Spacer />
        <Count>{trackedCount} of {menuItems.length} menu item{menuItems.length === 1 ? "" : "s"} tracked</Count>
      </Toolbar>

      <TableShell
        headers={["Menu item", "Ingredients", "Status", ""]}
        minWidth={640}
        isEmpty={rows.length === 0}
        emptyIcon="🍳"
        emptyText={menuItems.length === 0 ? "No menu items found" : "No menu items match these filters"}
      >
        {rows.map(({ mi, recipe }) => (
          <tr key={mi._id}>
            <td style={{ fontWeight: 600, color: "var(--text-1)" }}>{mi.name}</td>
            <td style={{ color: "var(--text-2)", fontSize: 11.5 }}>
              {recipe?.ingredients?.length
                ? recipe.ingredients.map((i) => `${i.inventoryItem?.name || "?"} ${num(i.quantity)}${i.unit}`).join(", ")
                : "—"}
            </td>
            <td>
              <span className={`zc-tag ${recipe ? "ready" : "done"}`}><i />{recipe ? "Tracked" : "Not tracked"}</span>
            </td>
            <td>
              <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                <button type="button" className="zc-btn ghost sm" onClick={() => openFor(mi)}>
                  {recipe ? "Edit recipe" : "Add recipe"}
                </button>
                {recipe && <button type="button" className="zc-btn danger sm" onClick={() => handleDelete(recipe)}>Remove</button>}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal
          title="Recipe"
          sub={menuItems.find((m) => m._id === menuItemId)?.name}
          onClose={() => setShowForm(false)}
          width={560}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save recipe"}
              </button>
            </>
          }
        >
          <label style={label}>Ingredients</label>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {lines.map((l, idx) => (
              <div key={idx} className="invp-iline">
                <select style={inp} value={l.inventoryItem} onChange={(e) => pickInventoryItem(idx, e.target.value)}>
                  <option value="">Select stock item…</option>
                  {stockItems.map((i) => <option key={i._id} value={i._id}>{i.name} ({i.unit})</option>)}
                </select>
                <input type="number" placeholder={`Qty${l.unit ? ` (${l.unit})` : ""}`} style={inp} value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                <button type="button" onClick={() => removeLine(idx)} aria-label="Remove ingredient"
                  style={{ background: "none", border: "none", color: "var(--stop-ink)", cursor: "pointer", fontSize: 15 }}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="zc-btn ghost sm" onClick={() => setLines((p) => [...p, emptyLine()])}>＋ Add ingredient</button>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 14 }}>
            Quantity is per ONE unit of this menu item — e.g. Rice 250 g means 250 g per plate ordered.
            The ingredient unit must match the stock item&rsquo;s unit (no auto-conversion).
          </div>
        </Modal>
      )}
    </div>
  );
}
