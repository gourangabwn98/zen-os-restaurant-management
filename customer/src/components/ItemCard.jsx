import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER, GREEN, RED } from "../theme.js";

export default function ItemCard({ item, qty, onOpen, onAdd, onInc, onDec }) {
  const outOfStock = item.stockTracked && !item.stockAvailable;

  return (
    <div
      onClick={() => onOpen(item)}
      style={{
        display: "flex", gap: 12, padding: "12px 4px", borderBottom: `1px solid ${BORDER}`,
        cursor: "pointer", opacity: outOfStock ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <VegDot veg={item.tag === "Veg"} />
          {outOfStock && (
            <span style={{ fontSize: 10, fontWeight: 700, color: RED, background: "#fee2e2", padding: "1px 7px", borderRadius: 8 }}>
              OUT OF STOCK
            </span>
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>₹{item.price}</div>
        {item.description && (
          <div style={{
            fontSize: 12, color: TEXT_FAINT, display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {item.description}
          </div>
        )}
      </div>

      <div style={{ width: 100, flexShrink: 0, position: "relative" }}>
        <div style={{
          width: 100, height: 100, borderRadius: 12, overflow: "hidden",
          background: "#f2f2f2", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {item.image
            ? <img src={item.image} alt={item.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 28 }}>🍽️</span>}
        </div>

        {!outOfStock && (
          qty > 0 ? (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", bottom: -12, left: "50%", transform: "translateX(-50%)",
                display: "flex", alignItems: "center", gap: 10, background: "#fff",
                border: `1.5px solid ${PINK}`, borderRadius: 10, padding: "4px 10px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              }}
            >
              <button onClick={() => onDec(item)} style={qtyBtnStyle}>−</button>
              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 14, textAlign: "center" }}>{qty}</span>
              <button onClick={() => onInc(item)} style={qtyBtnStyle}>+</button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(item); }}
              style={{
                position: "absolute", bottom: -12, left: "50%", transform: "translateX(-50%)",
                background: "#fff", border: `1.5px solid ${PINK}`, color: PINK, fontWeight: 800,
                fontSize: 12, borderRadius: 10, padding: "6px 18px", cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              }}
            >
              ADD
            </button>
          )
        )}
      </div>
    </div>
  );
}

const qtyBtnStyle = {
  border: "none", background: "none", color: PINK, fontWeight: 800,
  fontSize: 16, cursor: "pointer", width: 18, lineHeight: 1,
};

export function VegDot({ veg }) {
  return (
    <span style={{
      width: 13, height: 13, border: `1.5px solid ${veg ? GREEN : RED}`,
      display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 3, flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: veg ? GREEN : RED }} />
    </span>
  );
}
