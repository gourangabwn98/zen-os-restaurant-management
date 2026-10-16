import { useState } from "react";
import { useAppState } from "../context/AppState.jsx";
import { isOutOfStock } from "../hooks/useMenu.js";
import { VegDot, Stars, HeartButton } from "./ItemCard.jsx";
import QtyStepper from "./ui/QtyStepper.jsx";
import Button from "./ui/Button.jsx";
import Sheet from "./ui/Sheet.jsx";
import { nameWithSize, itemAddons, isNotSharable, SIGNATURE_LABEL, countAddonIds, stepAddonIds } from "../utils/menuDisplay.js";

/** Item details bottom sheet — pick quantity, the optional add-on and
 * special instructions, then add to cart: `onAdd(item, qty, notes, addonIds)`.
 * The price shown is a live preview; the server prices the order. */
export default function ItemDetailSheet({ item, onClose, onAdd }) {
  const { favorites } = useAppState();
  const [qty, setQty]     = useState(1);
  const [notes, setNotes] = useState("");
  const [addonIds, setAddonIds] = useState([]);
  const outOfStock = isOutOfStock(item);
  const hasOriginal = Number(item.originalPrice) > Number(item.price);
  const addons = itemAddons(item);
  const counts = countAddonIds(addonIds);
  const changeAddonQty = (id, delta) => setAddonIds((p) => stepAddonIds(p, id, delta));
  const extra = addons.reduce((s, a) => s + (counts.get(String(a._id)) || 0) * (Number(a.price) || 0), 0);
  const unit = (Number(item.price) || 0) + extra;
  const title = nameWithSize(item.name, item.size);
  const typeLabel = item.tag === "Others" ? "Others" : item.foodType || (item.tag === "Veg" ? "Veg" : "Non-veg");

  return (
    <Sheet
      onClose={onClose}
      label={title}
      footer={!outOfStock && (
        <Button onClick={() => { onAdd(item, qty, notes.trim(), addonIds); onClose(); }}>
          Add {qty} to cart · ₹{unit * qty}
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
        <VegDot tag={item.tag} />{typeLabel} · {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
      </div>
      <h3 style={{ marginTop: 6, marginBottom: 0 }}>{title}</h3>
      {item.isChefsPick && <div className="small" style={{ fontWeight: 800, marginTop: 4 }}>★ {SIGNATURE_LABEL}</div>}
      {item.notShareableCategory && (
        <div className="danger" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>{item.notShareableCategory} not shareable</div>
      )}
      {!item.notShareableCategory && isNotSharable(item) && (
        <div className="danger" style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>Not sharable</div>
      )}
      <Stars rating={item.rating} />
      {item.description && <p className="muted">{item.description}</p>}

      <div className="pf" style={{ marginTop: 16 }}>
        <div className="price" style={{ fontSize: 24 }}>
          ₹{unit}{hasOriginal && !extra && <s>₹{item.originalPrice}</s>}
        </div>
        {outOfStock
          ? <span className="na">Sold out</span>
          : <QtyStepper qty={qty} size="lg" onDec={() => setQty((q) => Math.max(1, q - 1))} onInc={() => setQty((q) => q + 1)} />}
      </div>

      {!outOfStock && addons.map((a) => (
        <div key={a._id} className="addon-opt" style={{ flexWrap: "wrap" }}>
          <span className="grow">+ {a.name} <span className="muted small">(optional)</span></span>
          <span>₹{a.price}</span>
          <QtyStepper qty={counts.get(String(a._id)) || 0} label={`${a.name} quantity`}
            onDec={() => changeAddonQty(String(a._id), -1)} onInc={() => changeAddonQty(String(a._id), 1)} />
        </div>
      ))}

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
