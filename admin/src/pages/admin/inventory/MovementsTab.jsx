import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { getStockMovements, getInventoryItems } from "../../../services/inventoryService.js";
import { T1, T2, T3, BORDER, inp, TableShell, fmtDateTime } from "./invUI.jsx";

const TYPE_COLORS = {
  PURCHASE:        "#34d399",
  SALE_DEDUCTION:  "#60a5fa",
  WASTAGE:         "#f87171",
  ADJUSTMENT:      "#fbbf24",
  PHYSICAL_COUNT:  "#a78bfa",
  REVERSAL:        "#34d399",
};

export default function MovementsTab() {
  const [movements, setMovements] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ inventoryItem: "", type: "" });

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([
        getStockMovements({ ...f, limit: 100 }),
        items.length ? Promise.resolve({ data: { items } }) : getInventoryItems(),
      ]);
      setMovements(mRes.data?.movements || []);
      if (!items.length) setItems(iRes.data?.items || []);
    } catch { toast.error("Failed to load stock movements"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(filters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => load(filters);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select style={{ ...inp, width: 200 }} value={filters.inventoryItem} onChange={(e) => setFilters({ ...filters, inventoryItem: e.target.value })}>
          <option value="">All items</option>
          {items.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
        </select>
        <select style={{ ...inp, width: 180 }} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">All types</option>
          {Object.keys(TYPE_COLORS).map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
        </select>
        <button onClick={applyFilters} style={{ ...inp, width: "auto", cursor: "pointer", background: "#252038" }}>Filter</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: T3 }}>Loading movements…</div>
      ) : (
        <TableShell
          headers={["Date", "Item", "Type", "Qty Change", "Balance After", "Reason", "By"]}
          isEmpty={movements.length === 0}
          emptyIcon="📒" emptyText="No stock movements match these filters"
        >
          {movements.map((m, idx) => (
            <tr key={m._id} style={{ borderBottom: idx < movements.length - 1 ? `1px solid ${BORDER}` : "none" }}>
              <td style={{ padding: "12px 18px", color: T2, fontSize: 12 }}>{fmtDateTime(m.createdAt)}</td>
              <td style={{ padding: "12px 18px", color: T1 }}>{m.inventoryItem?.name || "—"}</td>
              <td style={{ padding: "12px 18px" }}>
                <span style={{ color: TYPE_COLORS[m.type] || T2, fontSize: 11, fontWeight: 700 }}>{m.type.replace("_", " ")}</span>
              </td>
              <td style={{ padding: "12px 18px", fontWeight: 600, color: m.quantity >= 0 ? "#34d399" : "#f87171" }}>
                {m.quantity >= 0 ? "+" : ""}{m.quantity} {m.inventoryItem?.unit}
              </td>
              <td style={{ padding: "12px 18px", color: T2 }}>{m.balanceAfter} {m.inventoryItem?.unit}</td>
              <td style={{ padding: "12px 18px", color: T3, fontSize: 12 }}>{m.reason || "—"}</td>
              <td style={{ padding: "12px 18px", color: T3, fontSize: 12 }}>{m.createdBy?.name || "—"}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}
