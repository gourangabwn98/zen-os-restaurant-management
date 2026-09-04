import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getRecipes, saveRecipe, deleteRecipe as deleteRecipeApi, getInventoryItems } from "../../../services/inventoryService.js";
import { getMenu } from "../../../services/menuService.js";
import { T1, T2, T3, BORDER, inp, label, btnPrimary, btnGhost, btnDanger, Modal, TableShell } from "./invUI.jsx";

const emptyLine = () => ({ inventoryItem: "", quantity: "", unit: "" });

export default function RecipesTab() {
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [loading, setLoading] = useState(true);

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
    } catch { toast.error("Failed to load recipes"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const recipeByMenuItem = new Map(recipes.map((r) => [String(r.menuItem?._id || r.menuItem), r]));

  const openFor = (menuItem) => {
    setMenuItemId(menuItem._id);
    const existing = recipeByMenuItem.get(String(menuItem._id));
    setLines(
      existing?.ingredients?.length
        ? existing.ingredients.map((i) => ({ inventoryItem: i.inventoryItem?._id || i.inventoryItem, quantity: i.quantity, unit: i.unit }))
        : [emptyLine()]
    );
    setShowForm(true);
  };

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const pickInventoryItem = (idx, id) => {
    const stockItem = stockItems.find((i) => i._id === id);
    updateLine(idx, { inventoryItem: id, unit: stockItem?.unit || "" }); // unit MUST match the stock item's unit — see backend note
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

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading recipes…</div>;

  return (
    <div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 14 }}>
        Menu Item → Recipe → Ingredient → Inventory Stock. Menu items with no recipe are simply not inventory-tracked
        (they never get hidden or blocked from ordering).
      </div>

      <TableShell
        headers={["Menu Item", "Ingredients", "Recipe Status", "Action"]}
        isEmpty={menuItems.length === 0}
        emptyIcon="🍽️" emptyText="No menu items found"
      >
        {menuItems.map((mi, idx) => {
          const recipe = recipeByMenuItem.get(String(mi._id));
          return (
            <tr key={mi._id} style={{ borderBottom: idx < menuItems.length - 1 ? `1px solid ${BORDER}` : "none" }}>
              <td style={{ padding: "13px 18px", fontWeight: 600, color: T1 }}>{mi.name}</td>
              <td style={{ padding: "13px 18px", color: T2, fontSize: 12 }}>
                {recipe?.ingredients?.length
                  ? recipe.ingredients.map((i) => `${i.inventoryItem?.name || "?"} ${i.quantity}${i.unit}`).join(", ")
                  : "—"}
              </td>
              <td style={{ padding: "13px 18px" }}>
                <span style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: recipe ? "rgba(16,185,129,0.15)" : "rgba(107,114,128,0.15)",
                  color: recipe ? "#34d399" : "#9ca3af",
                }}>
                  {recipe ? "Tracked" : "Not tracked"}
                </span>
              </td>
              <td style={{ padding: "13px 18px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => openFor(mi)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>
                    {recipe ? "Edit Recipe" : "Add Recipe"}
                  </button>
                  {recipe && <button onClick={() => handleDelete(recipe)} style={btnDanger}>Remove</button>}
                </div>
              </td>
            </tr>
          );
        })}
      </TableShell>

      {showForm && (
        <Modal
          title="Edit Recipe"
          sub={menuItems.find((m) => m._id === menuItemId)?.name}
          onClose={() => setShowForm(false)}
          width={560}
        >
          <label style={label}>Ingredients</label>
          <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
            {lines.map((l, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, alignItems: "center" }}>
                <select style={inp} value={l.inventoryItem} onChange={(e) => pickInventoryItem(idx, e.target.value)}>
                  <option value="">Select stock item…</option>
                  {stockItems.map((i) => <option key={i._id} value={i._id}>{i.name} ({i.unit})</option>)}
                </select>
                <input type="number" placeholder={`Qty${l.unit ? ` (${l.unit})` : ""}`} style={inp} value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                <button onClick={() => removeLine(idx)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={() => setLines((p) => [...p, emptyLine()])} style={{ ...btnGhost, padding: "8px 14px", fontSize: 12, marginBottom: 16 }}>
            + Add ingredient
          </button>
          <div style={{ fontSize: 11, color: T3, marginBottom: 16 }}>
            Quantity is per ONE unit of this menu item — e.g. Rice 250g means 250g per plate ordered.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowForm(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary(saving), flex: 1 }}>{saving ? "Saving…" : "Save Recipe"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
