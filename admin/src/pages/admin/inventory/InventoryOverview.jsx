import { useEffect, useState, useCallback } from "react";
import { getInventoryOverview } from "../../../services/inventoryService.js";
import { StatChip, StatRow, Loading, ErrorBox, LevelBadge } from "./invUI.jsx";
import { money, num, fmtDate } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";

export default function InventoryOverview({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getInventoryOverview()
      .then((res) => { setData(res.data?.data || null); setError(false); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox onRetry={load} what="the inventory overview" />;

  const needsReorder = data.outOfStock.count + data.critical.count + data.lowStock.count;
  // The overview endpoint returns raw items per bucket (no computed `stockLevel`),
  // so tag each one from the bucket it came from.
  const attention = [
    ...data.outOfStock.items.map((it) => ({ ...it, stockLevel: "OUT_OF_STOCK" })),
    ...data.critical.items.map((it) => ({ ...it, stockLevel: "CRITICAL" })),
    ...data.lowStock.items.map((it) => ({ ...it, stockLevel: "LOW" })),
  ];

  if (data.totalItems === 0) {
    return (
      <div className="zc-card">
        <EmptyState
          icon="📦"
          title="No stock items yet"
          sub="Add stock items and record purchases to start tracking inventory value, low stock and wastage."
          action={<button type="button" className="zc-btn pri" onClick={() => onNavigate?.("items")}>Go to Stock items</button>}
        />
      </div>
    );
  }

  return (
    <div>
      <StatRow>
        <StatChip tone="brand" label="Stock value" value={money(data.stockValue)} sub={`${data.totalItems} tracked item${data.totalItems === 1 ? "" : "s"}`} />
        <StatChip tone={needsReorder ? "stop" : "good"} label="Needs reorder" value={needsReorder}
          sub={needsReorder
            ? [data.critical.count && `${data.critical.count} critical`, data.lowStock.count && `${data.lowStock.count} low`, data.outOfStock.count && `${data.outOfStock.count} out`].filter(Boolean).join(", ")
            : "All levels healthy"} />
        <StatChip tone={data.expiringSoon.count ? "warn" : "muted"} label="Expiring soon" value={data.expiringSoon.count}
          sub={`within ${data.expiringSoon.withinDays} days`} />
        <StatChip tone={data.today.wastage.qty ? "stop" : "muted"} label="Wastage today" value={num(data.today.wastage.qty)}
          sub={`${data.today.wastage.count} entr${data.today.wastage.count === 1 ? "y" : "ies"}`} />
      </StatRow>

      <StatRow mb={20}>
        <StatChip tone="info" label="Consumed today" value={num(data.today.consumption.qty)}
          sub={`${data.today.consumption.count} order deduction${data.today.consumption.count === 1 ? "" : "s"}`} />
        <StatChip tone="good" label="Purchased today" value={num(data.today.purchases.qty)}
          sub={`${data.today.purchases.count} purchase${data.today.purchases.count === 1 ? "" : "s"}`} />
      </StatRow>

      <div className="invp-two-col">
        {/* Needs attention — one reorder decision per row */}
        <div className="zc-card">
          <div className="zc-card-h"><span className="t">Needs attention</span><span className="s">act today</span></div>
          <div style={{ padding: "8px 18px 16px" }}>
            {attention.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
                All stock levels healthy ✓
              </div>
            ) : (
              <>
                {attention.slice(0, 8).map((it) => {
                  const target = Number(it.reorderLevel) || Number(it.criticalLevel) || 1;
                  const pct = Math.max(3, Math.min(100, Math.round((Number(it.currentStock) / target) * 100)));
                  return (
                    <div key={it._id} style={{ padding: "12px 0", borderBottom: "1px solid var(--edge)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{it.name}</span>
                        <LevelBadge level={it.stockLevel} />
                      </div>
                      <div className="zc-bar warn"><i style={{ width: `${pct}%` }} /></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>
                        <span>{num(it.currentStock)} {it.unit} in stock</span>
                        <span>reorder at {num(it.reorderLevel)} {it.unit}</span>
                      </div>
                    </div>
                  );
                })}
                <button type="button" onClick={() => onNavigate?.("lowstock")}
                  style={{ marginTop: 10, background: "none", border: "none", color: "var(--accent-ink)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}>
                  View all low stock →
                </button>
              </>
            )}
          </div>
        </div>

        {/* Expiring soon (batch-tracked items only) */}
        <div className="zc-card">
          <div className="zc-card-h">
            <span className="t">Expiring soon</span>
            <span className="s">within {data.expiringSoon.withinDays} days</span>
          </div>
          <div style={{ padding: "8px 18px 16px" }}>
            {data.expiringSoon.batches.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
                Nothing expiring soon ✓
              </div>
            ) : (
              data.expiringSoon.batches.slice(0, 8).map((b) => (
                <div key={b._id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "9px 0", borderBottom: "1px solid var(--edge)" }}>
                  <span style={{ color: "var(--text-1)" }}>
                    {b.inventoryItem?.name || "—"}{b.batchNo ? ` · ${b.batchNo}` : ""}
                  </span>
                  <span style={{ color: "var(--wait-ink)", fontWeight: 600 }}>{fmtDate(b.expiryDate)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
