import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getPurchases, createPurchase, getInventoryItems, getSuppliers } from "../../../services/inventoryService.js";
import {
  Modal, TableShell, Toolbar, Search, Spacer, Loading, ErrorBox, StatChip, StatRow,
} from "./invUI.jsx";
import { inp, label, money, num, fmtDate } from "./invKit.js";

const emptyLine = () => ({ inventoryItem: "", quantity: "", costPrice: "", batchNo: "", expiryDate: "" });

export default function PurchasesTab() {
  const [purchases, setPurchases] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

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
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setSupplier(""); setInvoiceNumber(""); setNotes(""); setLines([emptyLine()]); };
  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter((p) =>
      (p.supplier?.name || "").toLowerCase().includes(q) ||
      (p.invoiceNumber || "").toLowerCase().includes(q) ||
      p.items?.some((it) => (it.inventoryItem?.name || "").toLowerCase().includes(q)),
    );
  }, [purchases, search]);

  const totalValue = purchases.reduce((s, p) => s + Number(p.totalCost || 0), 0);

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what="purchases" />;

  return (
    <div>
      {purchases.length > 0 && (
        <StatRow>
          <StatChip tone="brand" label="Recorded value" value={money(totalValue)} sub={`${purchases.length} purchase${purchases.length === 1 ? "" : "s"}`} />
          <StatChip tone="muted" label="Purchases" value={purchases.length} sub={`from ${new Set(purchases.map((p) => p.supplier?._id).filter(Boolean)).size} supplier(s)`} />
        </StatRow>
      )}

      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder="Search by supplier, invoice or item" />
        <Spacer />
        <button type="button" className="zc-btn pri" onClick={() => setShowForm(true)}>＋ Record purchase</button>
      </Toolbar>

      <TableShell
        headers={["Date", "Supplier", "Items", "Invoice #", "Total cost", "Recorded by"]}
        minWidth={760}
        isEmpty={filtered.length === 0}
        emptyIcon="🧾"
        emptyText={purchases.length === 0 ? "No purchases recorded yet" : "No purchases match this search"}
      >
        {filtered.map((p) => (
          <tr key={p._id}>
            <td className="num" style={{ color: "var(--text-2)" }}>{fmtDate(p.purchaseDate || p.createdAt)}</td>
            <td style={{ color: "var(--text-1)", fontWeight: 600 }}>{p.supplier?.name || "—"}</td>
            <td style={{ color: "var(--text-2)", fontSize: 11.5 }}>
              {p.items.map((it) => `${it.inventoryItem?.name || "?"} (${num(it.quantity)}${it.inventoryItem?.unit || ""})`).join(", ")}
            </td>
            <td style={{ color: "var(--text-2)" }}>{p.invoiceNumber || "—"}</td>
            <td className="money">{money(p.totalCost)}</td>
            <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{p.createdBy?.name || "—"}</td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal
          title="Record purchase"
          sub="Adds stock and writes a movement for every line"
          onClose={() => setShowForm(false)}
          width={680}
          footer={
            <>
              <span style={{ marginRight: "auto", fontSize: 13, color: "var(--text-2)" }}>
                Total <b className="tnum" style={{ color: "var(--accent-ink)", fontSize: 16, marginLeft: 6 }}>{money(total)}</b>
              </span>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save purchase"}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={label}>Supplier</label>
              <select style={inp} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">— none —</option>
                {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Invoice / bill number</label>
              <input style={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
          </div>

          <label style={label}>Items</label>
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {lines.map((l, idx) => {
              const it = itemById(l.inventoryItem);
              return (
                <div key={idx} className="invp-pline">
                  <select style={inp} value={l.inventoryItem} onChange={(e) => updateLine(idx, { inventoryItem: e.target.value })}>
                    <option value="">Select item…</option>
                    {items.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
                  </select>
                  <input type="number" placeholder={`Qty${it ? ` (${it.unit})` : ""}`} style={inp} value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                  <input type="number" placeholder="Cost/unit ₹" style={inp} value={l.costPrice} onChange={(e) => updateLine(idx, { costPrice: e.target.value })} />
                  {it?.isBatchTracked
                    ? <input type="date" style={inp} value={l.expiryDate} onChange={(e) => updateLine(idx, { expiryDate: e.target.value })} title="Expiry date" />
                    : <div />}
                  <button type="button" onClick={() => removeLine(idx)} aria-label="Remove line"
                    style={{ background: "none", border: "none", color: "var(--stop-ink)", cursor: "pointer", fontSize: 15 }}>✕</button>
                </div>
              );
            })}
          </div>
          <button type="button" className="zc-btn ghost sm" onClick={() => setLines((p) => [...p, emptyLine()])}>＋ Add line</button>

          <div style={{ marginTop: 14 }}>
            <label style={label}>Notes</label>
            <input style={inp} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
