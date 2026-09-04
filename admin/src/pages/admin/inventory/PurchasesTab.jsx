import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getPurchases, createPurchase, getInventoryItems, getSuppliers } from "../../../services/inventoryService.js";
import { T1, T2, T3, BORDER, inp, label, btnPrimary, btnGhost, Modal, TableShell, money, fmtDate } from "./invUI.jsx";

const emptyLine = () => ({ inventoryItem: "", quantity: "", costPrice: "", batchNo: "", expiryDate: "" });

export default function PurchasesTab() {
  const [purchases, setPurchases] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([emptyLine()]);

  const load = useCallback(async () => {
    try {
      const [pRes, iRes, sRes] = await Promise.all([getPurchases(), getInventoryItems(), getSuppliers()]);
      setPurchases(pRes.data?.purchases || []);
      setItems(iRes.data?.items || []);
      setSuppliers(sRes.data?.suppliers || []);
    } catch { toast.error("Failed to load purchases"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setSupplier(""); setInvoiceNumber(""); setNotes(""); setLines([emptyLine()]); };

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const itemById = (id) => items.find((i) => i._id === id);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.costPrice) || 0), 0);

  const handleSave = async () => {
    const validLines = lines.filter((l) => l.inventoryItem && Number(l.quantity) > 0 && Number(l.costPrice) >= 0);
    if (!validLines.length) return toast.error("Add at least one valid line item");
    setSaving(true);
    try {
      await createPurchase({
        supplier: supplier || null,
        invoiceNumber, notes,
        items: validLines.map((l) => ({
          inventoryItem: l.inventoryItem, quantity: Number(l.quantity), costPrice: Number(l.costPrice),
          batchNo: l.batchNo || "", expiryDate: l.expiryDate || null,
        })),
      });
      toast.success("Purchase recorded — stock updated");
      setShowForm(false);
      resetForm();
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Failed to record purchase"); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading purchases…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={() => setShowForm(true)} style={btnPrimary(false)}>+ Record Purchase</button>
      </div>

      <TableShell
        headers={["Date", "Supplier", "Items", "Invoice #", "Total Cost", "Recorded By"]}
        isEmpty={purchases.length === 0}
        emptyIcon="🧾" emptyText="No purchases recorded yet"
      >
        {purchases.map((p, idx) => (
          <tr key={p._id} style={{ borderBottom: idx < purchases.length - 1 ? `1px solid ${BORDER}` : "none" }}>
            <td style={{ padding: "13px 18px", color: T2 }}>{fmtDate(p.purchaseDate || p.createdAt)}</td>
            <td style={{ padding: "13px 18px", color: T1 }}>{p.supplier?.name || "—"}</td>
            <td style={{ padding: "13px 18px", color: T2, fontSize: 12 }}>
              {p.items.map((it) => `${it.inventoryItem?.name || "?"} (${it.quantity}${it.inventoryItem?.unit || ""})`).join(", ")}
            </td>
            <td style={{ padding: "13px 18px", color: T2 }}>{p.invoiceNumber || "—"}</td>
            <td style={{ padding: "13px 18px", color: "#34d399", fontWeight: 600 }}>{money(p.totalCost)}</td>
            <td style={{ padding: "13px 18px", color: T3, fontSize: 12 }}>{p.createdBy?.name || "—"}</td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal title="Record Purchase" sub="Adds stock and creates a ledger entry for each line" onClose={() => setShowForm(false)} width={640}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={label}>Supplier</label>
              <select style={inp} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">— none —</option>
                {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Invoice / Bill Number</label>
              <input style={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
          </div>

          <label style={label}>Items</label>
          <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
            {lines.map((l, idx) => {
              const it = itemById(l.inventoryItem);
              return (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 6, alignItems: "center" }}>
                  <select style={inp} value={l.inventoryItem} onChange={(e) => updateLine(idx, { inventoryItem: e.target.value })}>
                    <option value="">Select item…</option>
                    {items.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
                  </select>
                  <input type="number" placeholder={`Qty${it ? ` (${it.unit})` : ""}`} style={inp} value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                  <input type="number" placeholder="Cost/unit ₹" style={inp} value={l.costPrice} onChange={(e) => updateLine(idx, { costPrice: e.target.value })} />
                  {it?.isBatchTracked ? (
                    <input type="date" style={inp} value={l.expiryDate} onChange={(e) => updateLine(idx, { expiryDate: e.target.value })} title="Expiry date" />
                  ) : <div />}
                  <button onClick={() => removeLine(idx)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>
              );
            })}
          </div>
          <button onClick={() => setLines((p) => [...p, emptyLine()])} style={{ ...btnGhost, padding: "8px 14px", fontSize: 12, marginBottom: 14 }}>
            + Add line
          </button>

          <div>
            <label style={label}>Notes</label>
            <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0" }}>
            <span style={{ color: T2, fontSize: 13 }}>Total Cost</span>
            <span style={{ color: "#34d399", fontSize: 18, fontWeight: 700 }}>{money(total)}</span>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowForm(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary(saving), flex: 1 }}>
              {saving ? "Saving…" : "Save Purchase"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
