import { ACCENT, GREEN, GLASS_BG, GLASS_BORDER, TEXT_FAINT } from "../theme.js";
import { statusColor } from "./StatusBadge.jsx";
import { mostUrgentStatus, runningTotal, formatElapsed } from "../utils/tableSession.js";

export default function TableCard({ table, session, active, onClick }) {
  const occupied = table.occupancyStatus === "OCCUPIED";
  const orders = session?.orders || [];
  const orderCount = orders.length;
  const total = runningTotal(orders);
  const urgent = mostUrgentStatus(orders);
  const ringColor = urgent ? statusColor(urgent) : ACCENT;
  const elapsed = occupied ? formatElapsed(session?.openedAt) : null;
  const needsAttention = urgent === "PENDING_CONFIRMATION";

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16, padding: "14px 8px 12px", cursor: "pointer", textAlign: "center",
        background: occupied ? `${ringColor}14` : GLASS_BG,
        border: `1.5px solid ${active ? ACCENT : occupied ? `${ringColor}70` : GLASS_BORDER}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        opacity: table.status === "Inactive" ? 0.4 : 1,
        boxShadow: active ? `0 0 0 1px ${ringColor}55, 0 8px 20px ${ringColor}4d` : "none",
        animation: needsAttention ? "pulseAmberGlow 1.8s ease-in-out infinite" : "none",
        transition: "transform .12s ease",
      }}
    >
      <div style={{
        width: 32, height: 32, margin: "0 auto 6px", borderRadius: "50%",
        background: occupied ? ringColor : "rgba(52,211,153,0.16)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
      }}>
        {occupied ? "🍽️" : "◻️"}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Table {table.tableNo}</div>
      <div style={{ fontSize: 10, color: TEXT_FAINT, marginTop: 1 }}>{table.seats} seats</div>

      {occupied ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8, fontSize: 9.5, fontWeight: 700, color: ringColor }}>
            <span>🧾 {orderCount}</span>
            {elapsed && <span style={{ color: TEXT_FAINT, fontWeight: 600 }}>· ⏱ {elapsed}</span>}
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginTop: 3 }}>₹{total}</div>
        </>
      ) : (
        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: GREEN }}>Available</div>
      )}
    </div>
  );
}
