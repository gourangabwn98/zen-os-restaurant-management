import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getLowStock } from "../../../services/inventoryService.js";
import { T1, T2, T3, BORDER, LevelBadge, TableShell } from "./invUI.jsx";

export default function LowStockTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLowStock()
      .then((res) => setItems(res.data?.items || []))
      .catch(() => toast.error("Failed to load low-stock items"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 80, color: T3 }}>Loading…</div>;

  return (
    <TableShell
      headers={["Item", "Category", "Current Stock", "Reorder Level", "Critical Level", "Level"]}
      isEmpty={items.length === 0}
      emptyIcon="✅" emptyText="Everything is well-stocked — nothing needs attention"
    >
      {items.map((item, idx) => (
        <tr key={item._id} style={{ borderBottom: idx < items.length - 1 ? `1px solid ${BORDER}` : "none" }}>
          <td style={{ padding: "13px 18px", fontWeight: 600, color: T1 }}>{item.name}</td>
          <td style={{ padding: "13px 18px", color: T2 }}>{item.category || "—"}</td>
          <td style={{ padding: "13px 18px", color: T1, fontWeight: 600 }}>{item.currentStock} {item.unit}</td>
          <td style={{ padding: "13px 18px", color: T2 }}>{item.reorderLevel} {item.unit}</td>
          <td style={{ padding: "13px 18px", color: T2 }}>{item.criticalLevel} {item.unit}</td>
          <td style={{ padding: "13px 18px" }}><LevelBadge level={item.stockLevel} /></td>
        </tr>
      ))}
    </TableShell>
  );
}
