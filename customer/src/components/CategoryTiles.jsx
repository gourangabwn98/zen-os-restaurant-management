import { isImageUrl } from "../hooks/useMenu.js";

/** Horizontally scrolling round category discs ("All Items" first). */
export default function CategoryTiles({ names, active, onPick, imageFor, sticky }) {
  const tile = (name, label, img) => (
    <button
      key={name} type="button" className="cat"
      aria-pressed={active === name} onClick={() => onPick(name)}
    >
      <span className="disc">{isImageUrl(img) ? <img src={img} alt="" loading="lazy" /> : (img || "🍽️")}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div className={`cats${sticky ? " sticky" : ""}`} role="toolbar" aria-label="Categories">
      {tile("All", "All Items", imageFor(names[0]))}
      {names.map((n) => tile(n, n, imageFor(n)))}
    </div>
  );
}
