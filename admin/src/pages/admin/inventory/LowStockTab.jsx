import { useEffect, useState, useCallback } from "react";
import { getLowStock } from "../../../services/inventoryService.js";
import { Loading, ErrorBox, LevelBadge } from "./invUI.jsx";
import { levelInk, num, money } from "./invKit.js";
import EmptyState from "../shared/EmptyState.jsx";

export default function LowStockTab({ onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getLowStock()
      .then((res) => { setItems(res.data?.items || []); setError(false); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorBox onRetry={load} what="low-stock items" />;

  if (items.length === 0) {
    return (
      <div className="zc-card">
        <EmptyState icon="✅" title="Everything is well-stocked" sub="No item is at or below its reorder level right now." />
      </div>
    );
  }

  return (
    <div className="invp-queue">
      {items.map((it) => {
        const crit = it.stockLevel === "CRITICAL" || it.stockLevel === "OUT_OF_STOCK";
        return (
          <div key={it._id} className={`invp-queue-row${crit ? " crit" : ""}`}>
            <span className="invp-queue-ic" aria-hidden="true">⚠</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{it.name}</span>
                <LevelBadge level={it.stockLevel} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                {it.category || "Uncategorised"}
                {it.supplier?.name ? ` · ${it.supplier.name}` : ""}
                {it.costPrice ? ` · last paid ${money(it.costPrice)}/${it.unit}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <div className="tnum" style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.03em", color: levelInk(it.stockLevel) }}>
                {num(it.currentStock)} {it.unit}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>reorder at {num(it.reorderLevel)} {it.unit}</div>
            </div>
            {onNavigate && (
              <button type="button" className="zc-btn pri" style={{ flex: "none" }} onClick={() => onNavigate("purchases")}>
                Record purchase
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
