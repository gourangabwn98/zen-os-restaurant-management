import { ACCENT_GRADIENT, ACCENT_GLOW, GREEN, RED } from "../../theme.js";

export default function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  variant = "solid", // "solid" | "outline" | "danger" | "success"
  style,
  type = "button",
  id,
  ...rest
}) {
  const isBusy = disabled || loading;

  const base = {
    padding: "14px 20px",
    borderRadius: 16,
    fontWeight: 800,
    fontSize: 14.5,
    cursor: isBusy ? "not-allowed" : "pointer",
    transition: "transform .12s ease, opacity .15s ease",
    opacity: isBusy ? 0.55 : 1,
  };

  const variants = {
    solid: { border: "none", background: ACCENT_GRADIENT, color: "#fff", boxShadow: isBusy ? "none" : ACCENT_GLOW },
    outline: { border: "1.5px solid rgba(59,130,246,0.6)", background: "rgba(59,130,246,0.08)", color: "#60A5FA" },
    danger: { border: "1.5px solid rgba(248,113,113,0.55)", background: "rgba(248,113,113,0.08)", color: RED },
    success: { border: "none", background: "linear-gradient(135deg, #4ADE80 0%, #16A34A 100%)", color: "#fff", boxShadow: isBusy ? "none" : "0 8px 24px rgba(22,163,74,0.35)" },
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
