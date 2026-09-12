import { ACCENT_GRADIENT, GLASS_BG, GLASS_BORDER, TEXT_MUTED, ACCENT_GLOW } from "../../theme.js";

export default function Chip({ active, onClick, children, badge, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, position: "relative",
        padding: "9px 18px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        border: active ? "1px solid transparent" : `1px solid ${GLASS_BORDER}`,
        background: active ? ACCENT_GRADIENT : GLASS_BG,
        color: active ? "#fff" : TEXT_MUTED,
        boxShadow: active ? ACCENT_GLOW : "none",
        transition: "all .15s ease", whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span style={{
          marginLeft: 6, background: "#F87171", color: "#fff", fontSize: 9.5, fontWeight: 800,
          borderRadius: 10, padding: "1px 6px",
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}
