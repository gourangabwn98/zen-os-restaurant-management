import { ACCENT_GRADIENT, GLASS_BG, GLASS_BORDER, TEXT_MUTED, ACCENT_GLOW } from "../../theme.js";

export default function Chip({ active, onClick, children, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: "9px 18px",
        borderRadius: 20,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        border: active ? "1px solid transparent" : `1px solid ${GLASS_BORDER}`,
        background: active ? ACCENT_GRADIENT : GLASS_BG,
        color: active ? "#fff" : TEXT_MUTED,
        boxShadow: active ? ACCENT_GLOW : "none",
        transition: "all .15s ease",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
