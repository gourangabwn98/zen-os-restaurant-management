import { ACCENT, ACCENT_GRADIENT, GLASS_BG, GLASS_BORDER } from "../../theme.js";

/** Circular glass −/+ stepper. `size` controls the whole control's scale. */
export default function QtyStepper({ qty, onInc, onDec, size = "md", style }) {
  const dims = size === "sm"
    ? { btn: 32, font: 14, gap: 10, pad: "4px 8px" }
    : size === "lg"
    ? { btn: 42, font: 18, gap: 18, pad: "6px 4px" }
    : { btn: 34, font: 15, gap: 12, pad: "4px 8px" };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex", alignItems: "center", gap: dims.gap,
        background: GLASS_BG, border: `1px solid ${GLASS_BORDER}`,
        borderRadius: 999, padding: dims.pad, ...style,
      }}
    >
      <button onClick={onDec} style={btnStyle(dims.btn, dims.font)}>−</button>
      <span style={{ fontWeight: 800, fontSize: dims.font, minWidth: dims.font, textAlign: "center", color: "#fff" }}>
        {qty}
      </span>
      <button onClick={onInc} style={btnStyle(dims.btn, dims.font, true)}>+</button>
    </div>
  );
}

const btnStyle = (size, font) => ({
  width: size, height: size, borderRadius: "50%", border: "none",
  background: "rgba(255,255,255,0.08)", color: ACCENT, fontWeight: 800,
  fontSize: font, cursor: "pointer", lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
});

export function AddButton({ onClick, size = "md" }) {
  const dims = size === "sm" ? { pad: "9px 20px", font: 12.5 } : { pad: "10px 24px", font: 13 };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      aria-label="Add to cart"
      style={{
        background: ACCENT_GRADIENT, border: "none", color: "#fff", fontWeight: 800,
        fontSize: dims.font, letterSpacing: 0.3, borderRadius: 999, padding: dims.pad,
        cursor: "pointer", boxShadow: "0 6px 16px rgba(255,138,0,0.4)", minHeight: 34,
      }}
    >
      ADD
    </button>
  );
}
