import StatusBadge from "./StatusBadge.jsx";
import GlassCard from "./ui/GlassCard.jsx";
import { ACCENT, ACCENT_SOFT, TEXT_FAINT, TEXT_MUTED } from "../theme.js";

export default function OrderCard({ order, onClick, style }) {
  return (
    <GlassCard onClick={onClick} style={{ padding: "14px 16px", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 13.5, color: "#fff" }}>{order.orderId}</span>
            <span style={{
              fontSize: 9.5, fontWeight: 800, color: ACCENT, background: ACCENT_SOFT,
              padding: "2px 8px", borderRadius: 8,
            }}>
              {order.source}
            </span>
            <span style={{ fontSize: 10.5, color: TEXT_MUTED }}>
              {order.tableNo ? `Table ${order.tableNo}` : "Takeaway"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 6 }}>
            {(order.items || []).slice(0, 3).map((i) => `${i.name} ×${i.qty}`).join(", ")}
            {order.items?.length > 3 ? ` +${order.items.length - 3} more` : ""}
          </div>
          <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 4 }}>
            {order.guestName || order.user?.name || "Guest"} ·{" "}
            {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: ACCENT }}>₹{order.total}</div>
          <div style={{ marginTop: 6 }}><StatusBadge status={order.status} /></div>
        </div>
      </div>
    </GlassCard>
  );
}
