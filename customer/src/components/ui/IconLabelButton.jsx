import { GLASS_BG, GLASS_BORDER, ACCENT, ACCENT_SOFT, BLUR } from "../../theme.js";

/** Icon + visible text label, pill-shaped — for actions a first-time
 * customer needs to recognize at a glance without guessing what an
 * icon-only button does (e.g. header Favorites / Profile buttons). */
export default function IconLabelButton({ icon, label, onClick, active = false, style }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "8px 14px 8px 10px", borderRadius: 999,
        border: `1px solid ${active ? ACCENT : GLASS_BORDER}`,
        background: active ? ACCENT_SOFT : GLASS_BG,
        backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
        color: active ? ACCENT : "#fff",
        fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        transition: "transform .15s ease",
        ...style,
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      {label}
    </button>
  );
}
