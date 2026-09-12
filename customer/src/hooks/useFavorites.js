import { useState, useCallback, useEffect, useRef } from "react";
import { STORAGE } from "../theme.js";

const loadInitial = () => {
  try {
    const raw = localStorage.getItem(STORAGE.favorites);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
};

/**
 * Client-only favorites — no backend field exists for this, so it never
 * leaves localStorage (mirrors the useCart.js persistence pattern).
 */
export function useFavorites() {
  const [ids, setIds] = useState(loadInitial);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    localStorage.setItem(STORAGE.favorites, JSON.stringify([...ids]));
  }, [ids]);

  const toggle = useCallback((id) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const isFavorite = useCallback((id) => ids.has(id), [ids]);

  return { ids, toggle, isFavorite, count: ids.size };
}
