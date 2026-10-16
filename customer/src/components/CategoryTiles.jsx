import { isImageUrl } from "../hooks/useMenu.js";
import CategoryIcon from "./CategoryIcon.jsx";
import { useCenterActive } from "../hooks/useCenterActive.js";

/** Horizontally scrolling round category discs ("All Items" first).
 * Order = the admin's saved category order (MNU-02). A disc shows the
 * category's photo, else a dish photo from it, else its icon (MNU-06) —
 * never a blank disc or an emoji. */
export default function CategoryTiles({ names, active, onPick, imageFor, iconFor, sticky, isSpecial = () => false }) {
  // Tapping a tile glides it to the middle, so the next categories show.
  const rowRef = useCenterActive(active);
  const tile = (name, label, img, icon) => (
    <button
      key={name} type="button" className={`cat${isSpecial(name) ? " special" : ""}`}
      aria-pressed={active === name} onClick={() => onPick(name)}
    >
      <span className="disc">{isImageUrl(img) ? <img src={img} alt="" loading="lazy" /> : <CategoryIcon name={icon} />}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div ref={rowRef} className={`cats${sticky ? " sticky" : ""}`} role="toolbar" aria-label="Categories">
      {tile("All", "All Items", null, "thali")}
      {names.map((n) => tile(n, n, imageFor(n), iconFor ? iconFor(n) : "plate"))}
    </div>
  );
}
