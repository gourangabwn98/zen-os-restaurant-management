import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getWastage, createWastage, getInventoryItems } from "../../../services/inventoryService.js";
import { T1, T2, T3, BORDER, inp, label, btnPrimary, btnGhost, Modal, TableShell, money, fmtDate } from "./invUI.jsx";

const REASONS = ["Spoilage", "Expired", "Damaged", "Accident", "Other"];

export default function WastageTab() {
  const [logs, setLogs] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ inventoryItem: "", quantity: "", reason: "Spoilage", notes: "" });

  const load = useCallback(async () => {
    try {
      const [wRes, iRes] = await Promise.all([getWastage(), getInventoryItems()]);
      setLogs(wRes.data?.logs || []);
      setItems(iRes.data?.items || []);
    } catch { toast.error("Failed to load wastage logs"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedItem = items.find((i) => i._id === form.inventoryItem);

  const handleSave = async () => {
    if (!form.inventoryItem || !(Number(form.quantity) > 0)) return toast.error("Select an item and a quantity > 0");
    setSaving(true);
    try {
      await createWastage({ ...form, quantity: Number(form.quantity) });
      toast.success("Wastage recorded");
      setShowForm(false);
      setForm({ inventoryItem: "", quantity: "", reason: "Spoilage", notes: "" });
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Failed to record wastage"); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading wastage…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={() => setShowForm(true)} style={btnPrimary(false)}>+ Record Wastage</button>
      </div>

      <TableShell
        headers={["Date", "Item", "Qty", "Reason", "Cost Impact", "Notes", "Recorded By"]}
        isEmpty={logs.length === 0}
        emptyIcon="🗑️" emptyText="No wastage recorded"
      >
        {logs.map((l, idx) => (
          <tr key={l._id} style={{ borderBottom: idx < logs.length - 1 ? `1px solid ${BORDER}` : "none" }}>
            <td style={{ padding: "13px 18px", color: T2 }}>{fmtDate(l.wastageDate || l.createdAt)}</td>
            <td style={{ padding: "13px 18px", color: T1, fontWeight: 600 }}>{l.inventoryItem?.name || "—"}</td>
            <td style={{ padding: "13px 18px", color: T2 }}>{l.quantity} {l.inventoryItem?.unit}</td>
            <td style={{ padding: "13px 18px", color: "#f87171" }}>{l.reason}</td>
            <td style={{ padding: "13px 18px", color: "#f87171", fontWeight: 600 }}>{money(l.costImpact)}</td>
            <td style={{ padding: "13px 18px", color: T3, fontSize: 12 }}>{l.notes || "—"}</td>
            <td style={{ padding: "13px 18px", color: T3, fontSize: 12 }}>{l.recordedBy?.name || "—"}</td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal title="Record Wastage" sub="Deducts stock and logs the cost impact" onClose={() => setShowForm(false)}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>Item</label>
              <select style={inp} value={form.inventoryItem} onChange={(e) => setForm({ ...form, inventoryItem: e.target.value })}>
                <option value="">Select item…</option>
                {items.map((i) => <option key={i._id} value={i._id}>{i.name} ({i.currentStock} {i.unit} in stock)</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Quantity {selectedItem ? `(${selectedItem.unit})` : ""}</label>
              <input type="number" style={inp} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div>
              <label style={label}>Reason</label>
              <select style={inp} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Notes</label>
              <input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary(saving), flex: 1 }}>
                {saving ? "Saving…" : "Record Wastage"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
