import { useEffect, useRef } from "react";

/**
 * For a sideways-scrolling row of buttons: whenever `active` changes, glide
 * the pressed button (aria-pressed="true") to the middle of the row, so the
 * next options come into view — tapping the last visible tile reveals what
 * comes after it. Respects "reduce motion". Returns the ref for the row.
 */
export function useCenterActive(active) {
  const rowRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector('[aria-pressed="true"]');
    if (!row || !el) return;
    const left = el.offsetLeft - row.offsetLeft - (row.clientWidth - el.clientWidth) / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [active]);
  return rowRef;
}
