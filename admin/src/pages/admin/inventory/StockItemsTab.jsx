import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getInventoryItems, createInventoryItem, updateInventoryItem,
  deleteInventoryItem, adjustInventoryItem, getSuppliers,
} from "../../../services/inventoryService.js";
import {
  PINK, T1, T2, T3, BORDER, inp, label, btnPrimary, btnGhost, btnDanger,
  LevelBadge, Modal, TableShell,
} from "./invUI.jsx";

const UNITS = ["g", "kg", "ml", "l", "pcs", "dozen", "packet", "box"];
const emptyItem = { name: "", unit: "kg", category: "", reorderLevel: 0, criticalLevel: 0, costPrice: 0, supplier: "", isBatchTracked: false, notes: "" };

export default function StockItemsTab() {
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // item being edited, or null for "new"
  const [form, setForm] = useState(emptyItem);
  const [saving, setSaving] = useState(false);

  const [adjustTarget, setAdjustTarget] = useState(null); // item being adjusted
  const [adjustForm, setAdjustForm] = useState({ newStock: "", type: "MANUAL_ADJUSTMENT", reason: "" });
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itemsRes, supRes] = await Promise.all([getInventoryItems(), getSuppliers()]);
      setItems(itemsRes.data?.items || []);
      setSuppliers(supRes.data?.suppliers || []);
    } catch { toast.error("Failed to load stock items"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(emptyItem); setShowForm(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name, unit: item.unit, category: item.category || "",
      reorderLevel: item.reorderLevel, criticalLevel: item.criticalLevel,
      costPrice: item.costPrice, supplier: item.supplier?._id || "",
      isBatchTracked: item.isBatchTracked, notes: item.notes || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Item name is required");
    setSaving(true);
    try {
      const payload = { ...form, supplier: form.supplier || null };
      if (editing) {
        await updateInventoryItem(editing._id, payload);
        toast.success("Item updated");
      } else {
        await createInventoryItem(payload);
        toast.success("Item created — add stock via a Purchase");
      }
      setShowForm(false);
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (item) => {
    if (!window.confirm(`Deactivate "${item.name}"? History is preserved.`)) return;
    try { await deleteInventoryItem(item._id); toast.success("Item deactivated"); load(); }
    catch { toast.error("Failed to deactivate"); }
  };

  const openAdjust = (item, type) => {
    setAdjustTarget(item);
    setAdjustForm({ newStock: item.currentStock, type, reason: "" });
  };

  const handleAdjust = async () => {
    if (adjustForm.newStock === "" || Number(adjustForm.newStock) < 0) return toast.error("Enter a valid stock value");
    setAdjusting(true);
    try {
      await adjustInventoryItem(adjustTarget._id, {
        newStock: Number(adjustForm.newStock), type: adjustForm.type, reason: adjustForm.reason,
      });
      toast.success("Stock updated");
      setAdjustTarget(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Adjustment failed"); }
    finally { setAdjusting(false); }
  };

  const filtered = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading stock items…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
        <input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inp, maxWidth: 260 }} />
        <button onClick={openNew} style={btnPrimary(false)}>+ Add Stock Item</button>
      </div>

      <TableShell
        headers={["Item", "Category", "Current Stock", "Reorder / Critical", "Cost/Unit", "Level", "Actions"]}
        isEmpty={filtered.length === 0}
        emptyIcon="📦" emptyText="No stock items yet — click “Add Stock Item” to create one"
      >
        {filtered.map((item, idx) => (
          <tr key={item._id} style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${BORDER}` : "none" }}>
            <td style={{ padding: "13px 18px" }}>
              <div style={{ fontWeight: 600, color: T1 }}>{item.name}</div>
              {item.supplier?.name && <div style={{ fontSize: 11, color: T3 }}>{item.supplier.name}</div>}
            </td>
            <td style={{ padding: "13px 18px", color: T2 }}>{item.category || "—"}</td>
            <td style={{ padding: "13px 18px", color: T1, fontWeight: 600 }}>{item.currentStock} {item.unit}</td>
            <td style={{ padding: "13px 18px", color: T2, fontSize: 12 }}>{item.reorderLevel} / {item.criticalLevel} {item.unit}</td>
            <td style={{ padding: "13px 18px", color: T2 }}>₹{item.costPrice}</td>
            <td style={{ padding: "13px 18px" }}><LevelBadge level={item.stockLevel} /></td>
            <td style={{ padding: "13px 18px" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => openEdit(item)} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>Edit</button>
                <button onClick={() => openAdjust(item, "MANUAL_ADJUSTMENT")} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>Adjust</button>
                <button onClick={() => openAdjust(item, "PHYSICAL_COUNT")} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>Count</button>
                {item.status === "Active" && (
                  <button onClick={() => handleDeactivate(item)} style={{ ...btnDanger, padding: "6px 12px" }}>Deactivate</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      {/* ── Add/Edit Item Modal ── */}
      {showForm && (
        <Modal title={editing ? "Edit Stock Item" : "Add Stock Item"} onClose={() => setShowForm(false)}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>Item Name</label>
              <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Basmati Rice" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Unit</label>
                <select style={inp} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Category</label>
                <input style={inp} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Grains" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Reorder Level</label>
                <input type="number" style={inp} value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </div>
              <div>
                <label style={label}>Critical Level</label>
                <input type="number" style={inp} value={form.criticalLevel} onChange={(e) => setForm({ ...form, criticalLevel: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Cost Price / Unit (₹)</label>
                <input type="number" style={inp} value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
              </div>
              <div>
                <label style={label}>Default Supplier</label>
                <select style={inp} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
                  <option value="">— none —</option>
                  {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T2 }}>
              <input type="checkbox" checked={form.isBatchTracked} onChange={(e) => setForm({ ...form, isBatchTracked: e.target.checked })} />
              Track batches / expiry dates for this item
            </label>
            <div>
              <label style={label}>Notes</label>
              <input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {!editing && (
              <div style={{ fontSize: 12, color: T3, background: "#1a1625", padding: 10, borderRadius: 8 }}>
                New items start at 0 stock — record a Purchase afterwards to bring stock in.
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary(saving), flex: 1 }}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Item"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Adjust / Physical Count Modal ── */}
      {adjustTarget && (
        <Modal
          title={adjustForm.type === "PHYSICAL_COUNT" ? "Physical Stock Count" : "Adjust Stock"}
          sub={`${adjustTarget.name} — currently ${adjustTarget.currentStock} ${adjustTarget.unit}`}
          onClose={() => setAdjustTarget(null)}
          width={400}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>{adjustForm.type === "PHYSICAL_COUNT" ? "Counted Quantity" : "New Stock Value"} ({adjustTarget.unit})</label>
              <input type="number" style={inp} value={adjustForm.newStock} onChange={(e) => setAdjustForm({ ...adjustForm, newStock: e.target.value })} />
              <div style={{ fontSize: 11, color: T3, marginTop: 4 }}>
                Difference will be logged: {Number(adjustForm.newStock || 0) - adjustTarget.currentStock >= 0 ? "+" : ""}
                {(Number(adjustForm.newStock || 0) - adjustTarget.currentStock).toFixed(2)} {adjustTarget.unit}
              </div>
            </div>
            <div>
              <label style={label}>Reason</label>
              <input style={inp} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                placeholder={adjustForm.type === "PHYSICAL_COUNT" ? "e.g. Monthly count" : "e.g. Correcting entry error"} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setAdjustTarget(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={handleAdjust} disabled={adjusting} style={{ ...btnPrimary(adjusting), flex: 1 }}>
                {adjusting ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
