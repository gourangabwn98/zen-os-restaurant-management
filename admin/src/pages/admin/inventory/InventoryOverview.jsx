import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getInventoryOverview } from "../../../services/inventoryService.js";
import { CARD, BORDER, T1, T2, T3, PINK, StatChip, money, fmtDate } from "./invUI.jsx";

export default function InventoryOverview({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInventoryOverview()
      .then((res) => setData(res.data?.data))
      .catch(() => toast.error("Failed to load inventory overview"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading overview…</div>;
  if (!data) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>No data</div>;

  return (
    <div>
      {/* ── Top stat row ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <StatChip label="Total Items" value={data.totalItems} />
        <StatChip label="Stock Value" value={money(data.stockValue)} color="#34d399" />
        <StatChip label="Low Stock" value={data.lowStock.count} color="#fbbf24" />
        <StatChip label="Critical" value={data.critical.count} color="#fb923c" />
        <StatChip label="Out of Stock" value={data.outOfStock.count} color="#f87171" />
        <StatChip label="Expiring Soon" value={data.expiringSoon.count} color="#a78bfa" />
      </div>

      {/* ── Today row ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatChip label="Today's Consumption" value={`${data.today.consumption.qty} (${data.today.consumption.count} orders)`} color="#60a5fa" />
        <StatChip label="Today's Purchases" value={`${data.today.purchases.qty} (${data.today.purchases.count})`} color="#34d399" />
        <StatChip label="Today's Wastage" value={`${data.today.wastage.qty} (${data.today.wastage.count})`} color="#f87171" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* ── Needs attention ── */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 600, color: T1, marginBottom: 14, fontSize: 14 }}>Needs Attention</div>
          {[...data.outOfStock.items, ...data.critical.items, ...data.lowStock.items].length === 0 ? (
            <div style={{ color: T3, fontSize: 13, padding: "20px 0", textAlign: "center" }}>All stock levels healthy ✓</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...data.outOfStock.items, ...data.critical.items, ...data.lowStock.items].slice(0, 8).map((it) => (
                <div key={it._id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ color: T1 }}>{it.name}</span>
                  <span style={{ color: T2 }}>{it.currentStock} {it.unit}</span>
                </div>
              ))}
              <button onClick={() => onNavigate?.("lowstock")} style={{
                marginTop: 8, background: "none", border: "none", color: PINK, cursor: "pointer",
                fontSize: 12, fontWeight: 600, textAlign: "left", padding: 0,
              }}>View all low stock →</button>
            </div>
          )}
        </div>

        {/* ── Expiring soon ── */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 600, color: T1, marginBottom: 14, fontSize: 14 }}>
            Expiring within {data.expiringSoon.withinDays} days
          </div>
          {data.expiringSoon.batches.length === 0 ? (
            <div style={{ color: T3, fontSize: 13, padding: "20px 0", textAlign: "center" }}>Nothing expiring soon ✓</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.expiringSoon.batches.slice(0, 8).map((b) => (
                <div key={b._id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ color: T1 }}>{b.inventoryItem?.name || "—"} {b.batchNo && `(${b.batchNo})`}</span>
                  <span style={{ color: "#fbbf24" }}>{fmtDate(b.expiryDate)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
