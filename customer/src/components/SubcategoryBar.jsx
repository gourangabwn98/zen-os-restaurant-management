import { useCenterActive } from "../hooks/useCenterActive.js";

/**
 * Subcategory filter inside a menu section — one at a time.
 *
 * Design notes:
 *  • Sticky under the top bar, so on a long section (Main Course, 59 dishes)
 *    the filter stays in reach while scrolling — no scrolling back up.
 *  • "All" first; each chip carries its dish count, so the guest knows what
 *    a tap will show before tapping.
 *  • Active = filled brand pill (shape + colour + weight, never colour alone);
 *    aria-pressed for screen readers.
 *  • The row scrolls sideways; the right edge fades to say "there is more",
 *    and the picked chip is brought into view.
 */
export default function SubcategoryBar({ section, total, options, active, onPick }) {
  // The picked chip glides to the middle, so the next ones show.
  const rowRef = useCenterActive(active);

  const chip = (name, label, count) => {
    const on = active === name;
    return (
      <button
        key={name ?? "_all"} type="button" className="subchip" aria-pressed={on}
        onClick={() => onPick(on ? null : name)}
      >
        <span>{label}</span>
        <span className="n" aria-label={`${count} dishes`}>{count}</span>
      </button>
    );
  };

  return (
    <div className="subbar">
      <div ref={rowRef} className="subbar-row" role="toolbar" aria-label={`Filter ${section}`}>
        {chip(null, "All", total)}
        {options.map((s) => chip(s.name, s.name, s.count))}
      </div>
    </div>
  );
}
