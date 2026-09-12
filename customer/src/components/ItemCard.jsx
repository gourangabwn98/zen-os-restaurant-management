import { TEXT_FAINT, TEXT_MUTED, ACCENT, GREEN, RED, GLASS_BORDER } from "../theme.js";
import GlassCard from "./ui/GlassCard.jsx";
import QtyStepper, { AddButton } from "./ui/QtyStepper.jsx";
import { useAppState } from "../context/AppState.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

// Same breakpoint the .menu-grid CSS switches columns at — below it we use
// Zomato's mobile-app list-row layout, at/above it the card-grid layout
// (Zomato's own web menu pages use cards too, not a stretched list).
const DESKTOP_QUERY = "(min-width: 700px)";

export default function ItemCard({ item, qty, onOpen, onAdd, onInc, onDec }) {
  const { favorites } = useAppState();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const outOfStock = item.stockTracked && !item.stockAvailable;
  const isFav = favorites.isFavorite(item._id);

  const props = { item, qty, onOpen, onAdd, onInc, onDec, outOfStock, isFav, toggleFav: () => favorites.toggle(item._id) };
  return isDesktop ? <CardLayout {...props} /> : <ListRowLayout {...props} />;
}

// ── Tablet/desktop: image-on-top card, grid-friendly ────────────────────────
function CardLayout({ item, qty, onOpen, onAdd, onInc, onDec, outOfStock, isFav, toggleFav }) {
  return (
    <GlassCard
      onClick={() => onOpen(item)}
      style={{ overflow: "visible", opacity: outOfStock ? 0.6 : 1, transition: "transform .15s ease" }}
      padding={0}
    >
      <div style={{
        position: "relative", width: "100%", aspectRatio: "4 / 3", background: "rgba(255,255,255,0.04)",
        borderRadius: "16px 16px 0 0", overflow: "hidden",
      }}>
        {item.image
          ? <img src={item.image} alt={item.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🍽️</div>}

        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)" }} />

        <FavButton isFav={isFav} onClick={toggleFav} style={{ top: 10, right: 10 }} />

        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 6 }}>
          <VegDot veg={item.tag === "Veg"} />
          {outOfStock && <OutOfStockBadge />}
        </div>

        {!outOfStock && (
          <div style={{ position: "absolute", bottom: -14, right: 12 }}>
            {qty > 0
              ? <QtyStepper qty={qty} size="md" onInc={() => onInc(item)} onDec={() => onDec(item)} style={{ boxShadow: "0 6px 16px rgba(0,0,0,0.4)" }} />
              : <AddButton size="md" onClick={() => onAdd(item)} />}
          </div>
        )}
      </div>

      <div style={{ padding: "16px 14px 18px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: ACCENT, marginTop: 5 }}>₹{item.price}</div>
        {item.description && (
          <div style={{
            fontSize: 11.5, color: TEXT_FAINT, marginTop: 4, display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4,
          }}>
            {item.description}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ── Mobile: Zomato-style dense list row, thumbnail on the right ────────────
function ListRowLayout({ item, qty, onOpen, onAdd, onInc, onDec, outOfStock, isFav, toggleFav }) {
  return (
    <GlassCard
      onClick={() => onOpen(item)}
      style={{ display: "flex", gap: 12, padding: "14px", opacity: outOfStock ? 0.6 : 1 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <VegDot veg={item.tag === "Veg"} />
          {outOfStock && <OutOfStockBadge />}
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: ACCENT, marginTop: 4 }}>₹{item.price}</div>
        {item.description && (
          <div style={{
            fontSize: 12, color: TEXT_MUTED, marginTop: 5, display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4,
          }}>
            {item.description}
          </div>
        )}
      </div>

      <div style={{ width: 92, flexShrink: 0, position: "relative" }}>
        <div style={{
          width: 92, height: 92, borderRadius: 14, overflow: "hidden",
          background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {item.image
            ? <img src={item.image} alt={item.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 28 }}>🍽️</span>}
        </div>

        <FavButton isFav={isFav} onClick={toggleFav} style={{ top: -6, right: -6, width: 26, height: 26, fontSize: 12 }} />

        {!outOfStock && (
          <div style={{ position: "absolute", bottom: -14, left: "50%", transform: "translateX(-50%)" }}>
            {qty > 0
              ? <QtyStepper qty={qty} size="sm" onInc={() => onInc(item)} onDec={() => onDec(item)} style={{ boxShadow: "0 6px 16px rgba(0,0,0,0.4)" }} />
              : <AddButton size="sm" onClick={() => onAdd(item)} />}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function FavButton({ isFav, onClick, style }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      style={{
        position: "absolute", width: 32, height: 32, borderRadius: "50%",
        border: `1px solid ${GLASS_BORDER}`, background: "rgba(8,7,12,0.6)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15,
        animation: isFav ? "heartPop .25s ease" : "none", zIndex: 2,
        ...style,
      }}
    >
      {isFav ? "❤️" : "🤍"}
    </button>
  );
}

function OutOfStockBadge() {
  return (
    <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "rgba(248,113,113,0.9)", padding: "2px 8px", borderRadius: 8 }}>
      OUT OF STOCK
    </span>
  );
}

/** Colored dot alone is a menu convention that isn't universally known —
 * always pair it with the word so a customer doesn't have to guess. */
export function VegDot({ veg, withLabel = true }) {
  const color = veg ? GREEN : RED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      background: "rgba(8,7,12,0.6)", border: `1px solid ${color}88`,
      borderRadius: 8, padding: withLabel ? "3px 8px 3px 6px" : 2,
    }}>
      <span style={{
        width: 13, height: 13, border: `1.5px solid ${color}`,
        display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 3, flexShrink: 0,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      </span>
      {withLabel && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff" }}>{veg ? "Veg" : "Non-Veg"}</span>}
    </span>
  );
}
