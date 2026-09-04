import { useState } from "react";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER } from "../theme.js";
import { VegDot } from "./ItemCard.jsx";

export default function ItemDetailSheet({ item, onClose, onAdd }) {
  const [qty, setQty]     = useState(1);
  const [notes, setNotes] = useState("");
  const outOfStock = item.stockTracked && !item.stockAvailable;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
        display: "flex", alignItems: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxHeight: "88vh", overflowY: "auto", background: "#fff",
          borderRadius: "20px 20px 0 0", animation: "fadeUp .25s ease",
        }}
      >
        {item.image && (
          <img src={item.image} alt={item.name} style={{ width: "100%", height: 200, objectFit: "cover" }} />
        )}

        <div style={{ padding: "18px 18px 100px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <VegDot veg={item.tag === "Veg"} />
                {outOfStock && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", background: "#fee2e2", padding: "2px 8px", borderRadius: 8 }}>
                    OUT OF STOCK
                  </span>
                )}
              </div>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{item.name}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>₹{item.price}</div>
            </div>
            <button onClick={onClose} style={{
              width: 30, height: 30, borderRadius: "50%", border: `1px solid ${BORDER}`,
              background: "#fafafa", fontSize: 15, cursor: "pointer", flexShrink: 0,
            }}>✕</button>
          </div>

          {item.description && (
            <div style={{ fontSize: 13.5, color: TEXT_MUTED, lineHeight: 1.6, marginTop: 12 }}>
              {item.description}
            </div>
          )}

          {!outOfStock && (
            <>
              <div style={{ marginTop: 22 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 8 }}>
                  Special instructions (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. less spicy, no onions…"
                  rows={2}
                  style={{
                    width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${BORDER}`,
                    fontSize: 13, resize: "none", boxSizing: "border-box", fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginTop: 20 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={stepBtn}>−</button>
                <span style={{ fontSize: 18, fontWeight: 800, minWidth: 24, textAlign: "center" }}>{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} style={stepBtn}>+</button>
              </div>
            </>
          )}
        </div>

        {!outOfStock && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 18px",
            background: "#fff", borderTop: `1px solid ${BORDER}`,
            paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
          }}>
            <button
              onClick={() => { onAdd(item, qty, notes.trim()); onClose(); }}
              style={{
                width: "100%", padding: 15, borderRadius: 14, border: "none",
                background: PINK, color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: "pointer",
              }}
            >
              Add {qty} to cart · ₹{item.price * qty}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const stepBtn = {
  width: 40, height: 40, borderRadius: "50%", border: `1.5px solid ${PINK}`,
  background: "#fff", color: PINK, fontSize: 19, fontWeight: 800, cursor: "pointer",
};
