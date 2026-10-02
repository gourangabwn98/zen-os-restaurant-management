// src/hooks/useVisibleInterval.js
// setInterval that pauses while the browser tab is hidden and catches up
// (runs once) as soon as it's visible again. Background admin tabs used to
// keep re-downloading order lists every few seconds for nobody to see.
import { useEffect, useRef } from "react";

export function useVisibleInterval(fn, ms, { immediate = false } = {}) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

  useEffect(() => {
    if (!ms) return undefined;
    let id = null;
    const tick = () => fnRef.current?.();
    const start = () => { if (id == null) id = setInterval(tick, ms); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    if (immediate) tick();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ms, immediate]);
}
