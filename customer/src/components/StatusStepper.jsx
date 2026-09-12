import { ACCENT, ACCENT_GRADIENT, RED, TEXT_FAINT, GLASS_BORDER } from "../theme.js";

const STEPS = [
  { key: "PENDING_CONFIRMATION", label: "Waiting for confirmation", icon: "🕒" },
  { key: "CONFIRMED",            label: "Confirmed",                icon: "✅" },
  { key: "PREPARING",            label: "Preparing",                 icon: "👨‍🍳" },
  { key: "READY",                label: "Ready",                      icon: "🔔" },
  { key: "DELIVERED",            label: "Delivered",                   icon: "🍽️" },
  { key: "COMPLETED",            label: "Completed",                    icon: "🎉" },
];

const MESSAGES = {
  PENDING_CONFIRMATION: "Waiting for restaurant confirmation…",
  CONFIRMED: "The kitchen has confirmed your order.",
  PREPARING: "Your food is being prepared.",
  READY: "Your order is ready!",
  DELIVERED: "Enjoy your meal!",
  COMPLETED: "Order completed. Thanks for visiting!",
  CANCELLED: "This order was cancelled.",
};

export default function StatusStepper({ status }) {
  if (status === "CANCELLED") {
    return (
      <div style={{ textAlign: "center", padding: "28px 16px" }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>❌</div>
        <div style={{ fontWeight: 800, fontSize: 16, color: RED }}>Order Cancelled</div>
        <div style={{ fontSize: 13, color: TEXT_FAINT, marginTop: 4 }}>{MESSAGES.CANCELLED}</div>
      </div>
    );
  }

  const idx = STEPS.findIndex((s) => s.key === status);
  const activeIdx = idx === -1 ? 0 : idx;

  return (
    <div style={{ padding: "24px 16px 8px" }}>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{
          width: 64, height: 64, margin: "0 auto 10px", borderRadius: "50%",
          background: ACCENT_GRADIENT, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 28, boxShadow: "0 0 0 1px rgba(255,138,0,0.35), 0 10px 28px rgba(255,138,0,0.4)",
        }}>
          {STEPS[activeIdx]?.icon}
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, marginTop: 6, color: "#fff" }}>{STEPS[activeIdx]?.label}</div>
        <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 3 }}>{MESSAGES[status]}</div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {STEPS.map((s, i) => (
          <div key={s.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
            {i > 0 && (
              <div style={{
                position: "absolute", top: 9, right: "50%", width: "100%", height: 2,
                background: i <= activeIdx ? ACCENT : GLASS_BORDER, zIndex: 0,
                boxShadow: i <= activeIdx ? "0 0 8px rgba(255,138,0,0.5)" : "none",
              }} />
            )}
            <div style={{
              width: 20, height: 20, borderRadius: "50%", zIndex: 1,
              background: i <= activeIdx ? ACCENT_GRADIENT : "rgba(255,255,255,0.06)",
              border: `2px solid ${i <= activeIdx ? ACCENT : GLASS_BORDER}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: i === activeIdx ? "0 0 10px rgba(255,138,0,0.6)" : "none",
            }}>
              {i < activeIdx && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900 }}>✓</span>}
              {i === activeIdx && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
            </div>
            <div style={{
              fontSize: 9.5, textAlign: "center", marginTop: 6, color: i <= activeIdx ? ACCENT : TEXT_FAINT,
              fontWeight: i === activeIdx ? 800 : 500, lineHeight: 1.3,
            }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
