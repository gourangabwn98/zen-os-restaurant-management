import { GLASS_BG, GLASS_BORDER, ACCENT, ACCENT_SOFT, BLUR } from "../../theme.js";

export default function IconButton({
  children,
  onClick,
  size = 38,
  active = false,
  label,
  style,
  ...rest
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `1px solid ${active ? ACCENT : GLASS_BORDER}`,
        background: active ? ACCENT_SOFT : GLASS_BG,
        backdropFilter: BLUR,
        WebkitBackdropFilter: BLUR,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.46,
        color: active ? ACCENT : "#fff",
        cursor: "pointer",
        flexShrink: 0,
        transition: "transform .15s ease, background .15s ease",
        ...style,
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {children}
    </button>
  );
}
