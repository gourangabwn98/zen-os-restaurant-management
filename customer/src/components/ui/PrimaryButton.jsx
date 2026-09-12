import { ACCENT_GRADIENT, ACCENT_GLOW } from "../../theme.js";

export default function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  variant = "solid", // "solid" | "outline" | "danger"
  style,
  type = "button",
  id,
  ...rest
}) {
  const isBusy = disabled || loading;

  const base = {
    width: "100%",
    padding: "14px 20px",
    borderRadius: 16,
    fontWeight: 800,
    fontSize: 14.5,
    cursor: isBusy ? "not-allowed" : "pointer",
    transition: "transform .12s ease, opacity .15s ease",
    opacity: isBusy ? 0.55 : 1,
  };

  const variants = {
    solid: {
      border: "none",
      background: ACCENT_GRADIENT,
      color: "#fff",
      boxShadow: isBusy ? "none" : ACCENT_GLOW,
    },
    outline: {
      border: "1.5px solid rgba(255,138,0,0.6)",
      background: "rgba(255,138,0,0.08)",
      color: "#FF8A00",
    },
    danger: {
      border: "1.5px solid rgba(248,113,113,0.55)",
      background: "rgba(248,113,113,0.08)",
      color: "#F87171",
    },
  };

  return (
    <button
      id={id}
      type={type}
      onClick={onClick}
      disabled={isBusy}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => { if (!isBusy) e.currentTarget.style.transform = "scale(0.98)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {children}
    </button>
  );
}
