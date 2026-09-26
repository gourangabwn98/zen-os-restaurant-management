import { useAppState } from "../context/AppState.jsx";
import { isOutOfStock, discountPct } from "../hooks/useMenu.js";
import QtyStepper, { AddButton } from "./ui/QtyStepper.jsx";
import Icon from "./ui/Icon.jsx";

/** Menu product card (reference ".pcard") — photo, favourite heart, veg
 * mark, rating, price (+ struck original price) and the +/stepper control. */
export default function ItemCard({ item, qty, onOpen, onAdd, onInc, onDec, context }) {
  const { favorites } = useAppState();
  const outOfStock = isOutOfStock(item);
  const isFav = favorites.isFavorite(item._id);
  const off = discountPct(item);
  const hasOriginal = Number(item.originalPrice) > Number(item.price);

  return (
    <article className={`pcard${outOfStock ? " off" : ""}`}>
      <ItemBadge item={item} off={off} context={context} />
      <HeartButton isFav={isFav} onClick={() => favorites.toggle(item._id)} />

      <button type="button" className="ph" onClick={() => onOpen(item)} aria-label={`View ${item.name}`}>
        {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">🍽️</span>}
      </button>

      <div className="bd">
        <button type="button" className="nm" onClick={() => onOpen(item)}>
          <VegDot veg={item.tag === "Veg"} />{item.name}
        </button>
        <div className="ds">{item.description || item.category}</div>
        <Stars rating={item.rating} />
        <div className="pf">
          <div className="price">₹{item.price}{hasOriginal && <s>₹{item.originalPrice}</s>}</div>
          {outOfStock
            ? <span className="na">Sold out</span>
            : qty > 0
              ? <QtyStepper qty={qty} onInc={() => onInc(item)} onDec={() => onDec(item)} label={`${item.name} quantity`} />
              : <AddButton onClick={() => onAdd(item)} label={`Add ${item.name}`} />}
        </div>
      </div>
    </article>
  );
}

function ItemBadge({ item, off, context }) {
  if (off >= 10) return <span className="badge save">Save {off}%</span>;
  if (Number(item.rating) >= 4.5) return <span className="badge">Bestseller</span>;
  if (context === "popular" && Number(item.rating) >= 4) return <span className="badge amber">Popular</span>;
  return null;
}

export function HeartButton({ isFav, onClick }) {
  return (
    <button
      type="button" className="heart" aria-pressed={isFav}
      aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <Icon name="heart" className="" />
    </button>
  );
}

export function Stars({ rating }) {
  const r = Number(rating) || 0;
  const n = Math.round(r);
  return (
    <div className="stars" aria-label={`Rated ${r.toFixed(1)} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" className={i <= n ? "" : "e"} />)}
      <b>{r.toFixed(1)}</b>
    </div>
  );
}

/** Veg / non-veg mark (green square-dot / red square-triangle, the Indian
 * food-labelling convention) with an accessible name. */
export function VegDot({ veg }) {
  return <span className={`vdot${veg ? "" : " nv"}`} role="img" aria-label={veg ? "Veg" : "Non-veg"} />;
}
