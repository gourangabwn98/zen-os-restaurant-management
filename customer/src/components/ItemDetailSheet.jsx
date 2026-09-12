import { useState } from "react";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, BG_SECONDARY } from "../theme.js";
import { VegDot } from "./ItemCard.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import { useAppState } from "../context/AppState.jsx";

export default function ItemDetailSheet({ item, onClose, onAdd }) {
  const { favorites } = useAppState();
  const [qty, setQty]     = useState(1);
  const [notes, setNotes] = useState("");
  const outOfStock = item.stockTracked && !item.stockAvailable;
  const isFav = favorites.isFavorite(item._id);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
        display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "90vh", overflowY: "auto",
          background: BG_SECONDARY, borderRadius: "24px 24px 0 0", animation: "fadeUp .25s ease",
          border: `1px solid ${GLASS_BORDER}`, borderBottom: "none",
        }}
      >
        <div style={{ position: "relative", width: "100%", height: 260, background: "rgba(255,255,255,0.04)" }}>
          {item.image
            ? <img src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56 }}>🍽️</div>}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.25) 100%)" }} />

          <button onClick={onClose} aria-label="Close" style={circleBtn("left")}>✕</button>
          <button
            onClick={() => favorites.toggle(item._id)}
            aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
            style={circleBtn("right")}
          >
            {isFav ? "❤️" : "🤍"}
          </button>
        </div>

        <div style={{ padding: "20px 20px 110px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <VegDot veg={item.tag === "Veg"} />
            {outOfStock && (
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "rgba(248,113,113,0.9)", padding: "2px 9px", borderRadius: 8 }}>
                OUT OF STOCK
              </span>
            )}
          </div>

          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{item.name}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: ACCENT, marginTop: 6 }}>₹{item.price}</div>

          {item.description && (
            <div style={{ fontSize: 13.5, color: TEXT_MUTED, lineHeight: 1.6, marginTop: 14 }}>
              {item.description}
            </div>
          )}

          {!outOfStock && (
            <>
              <div style={{ marginTop: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 8 }}>
                  Special instructions (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. less spicy, no onions…"
                  rows={2}
                  style={{
                    width: "100%", padding: 13, borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
                    background: GLASS_BG, color: "#fff", fontSize: 13, resize: "none",
                    boxSizing: "border-box", fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 22 }}>
                <QtyStepper qty={qty} size="lg" onDec={() => setQty((q) => Math.max(1, q - 1))} onInc={() => setQty((q) => q + 1)} />
              </div>
            </>
          )}
        </div>

        {!outOfStock && (
          <div style={{
            position: "sticky", bottom: 0, left: 0, right: 0, padding: "14px 20px",
            background: "rgba(12,10,20,0.85)", backdropFilter: "blur(16px)", borderTop: `1px solid ${GLASS_BORDER}`,
            paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
          }}>
            <PrimaryButton onClick={() => { onAdd(item, qty, notes.trim()); onClose(); }}>
              Add {qty} to cart · ₹{item.price * qty}
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

const circleBtn = (side) => ({
  position: "absolute", top: 14, [side]: 14, width: 38, height: 38, borderRadius: "50%",
  border: `1px solid ${GLASS_BORDER}`, background: "rgba(8,7,12,0.55)", backdropFilter: "blur(10px)",
  fontSize: 16, cursor: "pointer", color: "#fff",
});
