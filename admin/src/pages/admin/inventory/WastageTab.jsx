import { useEffect, useState, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { getWastage, createWastage, getInventoryItems } from "../../../services/inventoryService.js";
import {
  Modal, TableShell, Toolbar, Search, Seg, Spacer, Loading, ErrorBox, StatChip, StatRow,
} from "./invUI.jsx";
import { inp, label, money, num, fmtDateTime } from "./invKit.js";

// WASTAGE_REASONS — restaurant-server/utils/inventoryConstants.js
const REASONS = ["Spoilage", "Expired", "Damaged", "Accident", "Other"];
const REASON_KIND = { Spoilage: "stop", Expired: "stop", Damaged: "wait", Accident: "wait", Other: "done" };

export default function WastageTab() {
  const [logs, setLogs] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("All");

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ inventoryItem: "", quantity: "", reason: "Spoilage", notes: "" });

  const load = useCallback(async () => {
    try {
      const [wRes, iRes] = await Promise.all([getWastage(), getInventoryItems()]);
      setLogs(wRes.data?.logs || []);
      setItems(iRes.data?.items || []);
      setError(false);
    } catch { setError(true); }
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

  const stats = useMemo(() => {
    const totalValue = logs.reduce((s, l) => s + Number(l.costImpact || 0), 0);
    const byReason = {};
    logs.forEach((l) => { byReason[l.reason] = (byReason[l.reason] || 0) + 1; });
    const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];
    return { totalValue, count: logs.length, topReason: top ? top[0] : "—" };
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (reason !== "All" && l.reason !== reason) return false;
      if (q && !(l.inventoryItem?.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, reason]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox onRetry={load} what="wastage logs" />;

  return (
    <div>
      {logs.length > 0 && (
        <StatRow>
          <StatChip tone="stop" label="Written off" value={money(stats.totalValue)} sub={`${stats.count} entr${stats.count === 1 ? "y" : "ies"}`} />
          <StatChip tone="muted" label="Entries" value={stats.count} sub={`across ${new Set(logs.map((l) => l.inventoryItem?._id)).size} item(s)`} />
          <StatChip tone="warn" label="Top reason" value={stats.topReason} sub="most-logged this list" />
        </StatRow>
      )}

      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder="Search wastage log" />
        <Seg options={["All", ...REASONS]} value={reason} onChange={setReason} ariaLabel="Filter by reason" />
        <Spacer />
        <button type="button" className="zc-btn pri" onClick={() => setShowForm(true)}>＋ Log wastage</button>
      </Toolbar>

      <TableShell
        headers={["Date", "Item", "Qty", "Reason", "Cost impact", "Notes", "Recorded by"]}
        minWidth={760}
        isEmpty={filtered.length === 0}
        emptyIcon="🗑️"
        emptyText={logs.length === 0 ? "No wastage recorded" : "No entries match these filters"}
      >
        {filtered.map((l) => (
          <tr key={l._id}>
            <td className="num" style={{ color: "var(--text-2)", fontSize: 11.5 }}>{fmtDateTime(l.wastageDate || l.createdAt)}</td>
            <td style={{ color: "var(--text-1)", fontWeight: 600 }}>{l.inventoryItem?.name || "—"}</td>
            <td className="num" style={{ color: "var(--text-2)" }}>{num(l.quantity)} {l.inventoryItem?.unit}</td>
            <td><span className={`zc-tag ${REASON_KIND[l.reason] || "done"}`}><i />{l.reason}</span></td>
            <td className="money neg">{money(l.costImpact)}</td>
            <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{l.notes || "—"}</td>
            <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{l.recordedBy?.name || "—"}</td>
          </tr>
        ))}
      </TableShell>

      {showForm && (
        <Modal
          title="Log wastage"
          sub="Deducts stock and records the cost impact"
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" className="zc-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="zc-btn pri" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Record wastage"}
              </button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={label}>Item</label>
              <select style={inp} value={form.inventoryItem} onChange={(e) => setForm({ ...form, inventoryItem: e.target.value })}>
                <option value="">Select item…</option>
                {items.map((i) => <option key={i._id} value={i._id}>{i.name} ({num(i.currentStock)} {i.unit} in stock)</option>)}
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
          </div>
        </Modal>
      )}
    </div>
  );
}
