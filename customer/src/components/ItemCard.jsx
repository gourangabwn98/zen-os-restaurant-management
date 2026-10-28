import { useAppState } from "../context/AppState.jsx";
import { isOutOfStock, discountPct } from "../hooks/useMenu.js";
import QtyStepper, { AddButton } from "./ui/QtyStepper.jsx";
import Icon from "./ui/Icon.jsx";
import { nameWithSize, itemAddons, isNotSharable, SIGNATURE_LABEL } from "../utils/menuDisplay.js";

/** Menu product card (reference ".pcard") — photo, favourite heart, veg
 * mark, rating, price (+ struck original price) and the +/stepper control. */
export default function ItemCard({ item, qty, onOpen, onAdd, onInc, onDec, context }) {
  const { favorites } = useAppState();
  const outOfStock = isOutOfStock(item);
  const isFav = favorites.isFavorite(item._id);
  const off = discountPct(item);
  const hasOriginal = Number(item.originalPrice) > Number(item.price);
  const hasAddons = itemAddons(item).length > 0;
  const unavailable = item.isAvailable === false || outOfStock;

  return (
    <article className={`pcard${unavailable ? " off" : ""}`}>
      <ItemBadge item={item} off={off} context={context} />
      <HeartButton isFav={isFav} onClick={() => favorites.toggle(item._id)} />

      <button type="button" className="ph" onClick={() => onOpen(item)} aria-label={`View ${item.name}`}>
        {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">🍽️</span>}
      </button>

      <div className="bd">
        <button type="button" className="nm" onClick={() => onOpen(item)}>
          <VegDot tag={item.tag} />{nameWithSize(item.name, item.size)}
        </button>
        <div className="ds">{item.description || item.subcategory || item.category}</div>
        {itemAddons(item).slice(0, 1).map((a) => (
          <div key={a._id} className="addon">+ {a.name} ₹{a.price}</div>
        ))}
        {item.notShareableCategory && (
          <div className="danger" style={{ fontSize: 11.5, fontWeight: 800 }}>{item.notShareableCategory} not shareable</div>
        )}
        {!item.notShareableCategory && isNotSharable(item) && (
          <div className="danger" style={{ fontSize: 11.5, fontWeight: 800 }}>Not sharable</div>
        )}
        <Stars rating={item.rating} />
        <div className="pf">
          <div className="price">₹{item.price}{hasOriginal && <s>₹{item.originalPrice}</s>}</div>
          {unavailable
            ? <span className="na">Currently unavailable for ordering</span>
            : qty > 0
              ? <QtyStepper qty={qty} onInc={() => hasAddons ? onOpen(item) : onInc(item)} onDec={() => onDec(item)} label={`${item.name} quantity`} />
              : <AddButton onClick={() => hasAddons ? onOpen(item) : onAdd(item)} label={`Add ${item.name}`} />}
        </div>
      </div>
    </article>
  );
}

function ItemBadge({ item, off, context }) {
  if (item.isChefsPick) return <span className="badge amber">{SIGNATURE_LABEL}</span>;
  if (item.isTodaysSpecial) return <span className="badge save">Today's Special</span>;
  if (item.isMostPopular) return <span className="badge">Most Popular</span>;
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
 * food-labelling convention) with an accessible name. Pass the item's `tag`
 * ("Veg" | "Non Veg" | "Others") or `veg` directly; "Others" (cold drinks,
 * cigarettes…) gets no mark. */
export function VegDot({ veg, tag }) {
  if (tag === "Others") return null;
  if (tag !== undefined) veg = tag === "Veg";
  return <span className={`vdot${veg ? "" : " nv"}`} role="img" aria-label={veg ? "Veg" : "Non-veg"} />;
}
