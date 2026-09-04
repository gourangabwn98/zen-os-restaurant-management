import { STAT_COLORS, PRIMARY, BG_CARD, TEXT_SECONDARY } from "../../../theme.js";

export default function StatCard({ label, value, sub, colorIdx = 0, icon }) {
  const color = STAT_COLORS[colorIdx % STAT_COLORS.length];
  return (
    <div style={{
      background: "#1e1a2e",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16,
      padding: "20px",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Glow accent */}
      <div style={{
        position: "absolute", top: 0, right: 0,
        width: 80, height: 80,
        background: `radial-gradient(circle, ${color}22, transparent)`,
        borderRadius: "0 16px 0 80px",
      }} />

      {/* Icon circle */}
      {icon && (
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `${color}20`,
          border: `1px solid ${color}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, marginBottom: 12,
        }}>
          {icon}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6, fontWeight: 500, letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: color, letterSpacing: -0.5 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>{sub}</div>
      )}
    </div>
  );
}
