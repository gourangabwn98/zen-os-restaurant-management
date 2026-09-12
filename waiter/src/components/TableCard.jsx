import { ACCENT, ACCENT_LIGHT, ACCENT_SOFT, ACCENT_GRADIENT, GREEN, GLASS_BG, GLASS_BORDER, TEXT_FAINT } from "../theme.js";

export default function TableCard({ table, session, onClick, active }) {
  const occupied = table.occupancyStatus === "OCCUPIED";
  const orderCount = session?.orders?.length || 0;

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16, padding: "16px 10px", cursor: "pointer", textAlign: "center",
        background: occupied ? ACCENT_SOFT : GLASS_BG,
        border: `1.5px solid ${active ? ACCENT : occupied ? "rgba(59,130,246,0.45)" : GLASS_BORDER}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        opacity: table.status === "Inactive" ? 0.4 : 1,
        boxShadow: active ? "0 0 0 1px rgba(59,130,246,0.35), 0 8px 20px rgba(59,130,246,0.3)" : "none",
        transition: "transform .12s ease",
      }}
    >
      <div style={{
        width: 34, height: 34, margin: "0 auto 6px", borderRadius: "50%",
        background: occupied ? ACCENT_GRADIENT : "rgba(52,211,153,0.14)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
      }}>
        {occupied ? "🍽️" : "◻️"}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14.5, color: "#fff" }}>Table {table.tableNo}</div>
      <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 2 }}>{table.seats} seats</div>
      <div style={{
        marginTop: 7, fontSize: 10, fontWeight: 700,
        color: occupied ? ACCENT_LIGHT : GREEN,
      }}>
        {occupied ? `Occupied${orderCount ? ` · ${orderCount}` : ""}` : "Available"}
      </div>
    </div>
  );
}
