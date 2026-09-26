import { useState } from "react";
import { useAppState } from "../context/AppState.jsx";
import { isOutOfStock } from "../hooks/useMenu.js";
import { VegDot, Stars, HeartButton } from "./ItemCard.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import Button from "./ui/Button.jsx";
import Sheet from "./ui/Sheet.jsx";

/** Item details bottom sheet — pick quantity + special instructions, then
 * add to cart (same `onAdd(item, qty, notes)` contract as before). */
export default function ItemDetailSheet({ item, onClose, onAdd }) {
  const { favorites } = useAppState();
  const [qty, setQty]     = useState(1);
  const [notes, setNotes] = useState("");
  const outOfStock = isOutOfStock(item);
  const hasOriginal = Number(item.originalPrice) > Number(item.price);

  return (
    <Sheet
      onClose={onClose}
      label={item.name}
      footer={!outOfStock && (
        <Button onClick={() => { onAdd(item, qty, notes.trim()); onClose(); }}>
          Add {qty} to cart · ₹{item.price * qty}
        </Button>
      )}
    >
      <div className="detail-top">
        {item.image
          ? <img className="detail-img" src={item.image} alt={item.name} />
          : <div className="detail-ph" aria-hidden="true">🍽️</div>}
        <HeartButton isFav={favorites.isFavorite(item._id)} onClick={() => favorites.toggle(item._id)} />
      </div>

      <div className="muted small" style={{ display: "flex", alignItems: "center" }}>
        <VegDot veg={item.tag === "Veg"} />{item.tag === "Veg" ? "Veg" : "Non-veg"} · {item.category}
      </div>
      <h3 style={{ marginTop: 6, marginBottom: 0 }}>{item.name}</h3>
      <Stars rating={item.rating} />
      {item.description && <p className="muted">{item.description}</p>}

      <div className="pf" style={{ marginTop: 16 }}>
        <div className="price" style={{ fontSize: 24 }}>
          ₹{item.price}{hasOriginal && <s>₹{item.originalPrice}</s>}
        </div>
        {outOfStock
          ? <span className="na">Sold out</span>
          : <QtyStepper qty={qty} size="lg" onDec={() => setQty((q) => Math.max(1, q - 1))} onInc={() => setQty((q) => q + 1)} />}
      </div>

      {!outOfStock && (
        <label className="field" style={{ marginTop: 18 }}>
          <span>Special instructions (optional)</span>
          <textarea
            rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. less spicy, no onions…"
          />
        </label>
      )}
    </Sheet>
  );
}
