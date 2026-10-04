import { useEffect, useState, useCallback, useMemo } from "react";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import { getSocket } from "../services/socketService.js";

// Last response per query — lets Home/Menu/Offers render instantly when
// the customer switches tabs, while a fresh fetch runs in the background.
const cache = new Map();
let categoriesCache = null;
// Schedules are minute-granular, so a 1-minute poll keeps a time window
// opening/closing on time; admin edits arrive instantly via "menu:updated".
const MENU_REFRESH_MS = 60 * 1000;

/** Loads the menu via GET /menu (search + vegOnly stay server-side exactly
 * as before). `diet`: "all" | "veg" | "nonveg" — "nonveg" is a client-side
 * view filter since the API only knows vegOnly. */
export function useMenu({ search = "", diet = "all" } = {}) {
  const [debounced, setDebounced] = useState(search.trim());
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const key = `${debounced}|${diet === "veg"}`;
  const [items, setItems]     = useState(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!cache.has(key));
  const [error, setError]     = useState(null);
  const [categories, setCategories] = useState(categoriesCache || []);

  const load = useCallback(() => {
    if (cache.has(key)) setItems(cache.get(key)); else setLoading(true);
    setError(null);
    let stale = false;
    // Categories are schedule-filtered too, so refresh them with the items.
    getMenuCategories()
      .then(({ data }) => {
        categoriesCache = Array.isArray(data) ? data : [];
        if (!stale) setCategories(categoriesCache);
      })
      .catch(() => {});
    getMenu({ search: debounced || undefined, vegOnly: diet === "veg" ? "true" : undefined })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        cache.set(key, list);
        if (!stale) setItems(list);
      })
      .catch(() => { if (!stale) setError("Couldn't load the menu"); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [key, debounced, diet]);

  useEffect(() => load(), [load]);

  // Scheduled categories/items open and close during the day (the server
  // filters them in restaurant time) — re-fetch every minute, when the tab
  // comes back, and immediately when an admin changes the menu.
  useEffect(() => {
    let cancel = null;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      cancel?.();
      cancel = load();
    };
    const onMenuUpdated = () => {
      // Other search/diet views are stale too; keep the current one on screen
      // (no skeleton flash) while it re-fetches.
      for (const k of [...cache.keys()]) if (k !== key) cache.delete(k);
      refresh();
    };
    const id = setInterval(refresh, MENU_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    const socket = getSocket();
    socket.on("menu:updated", onMenuUpdated);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      socket.off("menu:updated", onMenuUpdated);
      cancel?.();
    };
  }, [load, key]);

  const visible = useMemo(() => {
    if (!items) return null;
    return diet === "nonveg" ? items.filter((it) => it.tag !== "Veg") : items;
  }, [items, diet]);

  // MNU-01: one item, every category it belongs to (`categoryList`, worked
  // out by the server: primary + extra + Fast Available / Chef's Picks /
  // Today's Special / data-driven ones). It's the same item object in each
  // section, so cart quantities and price can never differ between them.
  // MNU-02: sections follow the admin's saved category order (GET
  // /menu/categories is sorted by it); anything unknown keeps API order after.
  const grouped = useMemo(() => {
    if (!visible) return [];
    const map = new Map();
    for (const it of visible) {
      const cats = it.categoryList?.length ? it.categoryList : [it.category || "Other"];
      for (const c of cats) {
        if (!map.has(c)) map.set(c, []);
        map.get(c).push(it);
      }
    }
    const rank = new Map(categories.map((c, i) => [c.category, i]));
    return [...map.entries()].sort((a, b) => (rank.get(a[0]) ?? 1e6) - (rank.get(b[0]) ?? 1e6));
  }, [visible, categories]);

  /** MNU-06: the category's icon key (server: own pick → smart default → name guess). */
  const categoryIcon = useCallback((name) => categories.find((x) => x.category === name)?.icon || "plate", [categories]);
  /** Bengali name an admin gave the category, if any (display only). */
  const categoryMeta = useCallback((name) => categories.find((x) => x.category === name) || null, [categories]);

  // Returns an image URL, else the category's emoji placeholder (legacy
  // `image` values like "🍔"), else "". Emoji must never reach an <img src>.
  const categoryImage = useCallback((name) => {
    const c = categories.find((x) => x.category === name);
    // Built-in (smart) categories show their own picture or their icon, not a random dish.
    if (c?.kind === "SMART") return isImageUrl(c.categoryImageUrl) ? c.categoryImageUrl : "";
    const inCat = (items || []).filter((m) => (m.categoryList || [m.category]).includes(name));
    const url = [c?.categoryImageUrl, c?.categoryImage, ...inCat.map((m) => m.categoryImage), ...inCat.map((m) => m.image)]
      .find(isImageUrl);
    if (url) return url;
    return [c?.categoryImage, ...inCat.map((m) => m.categoryImage)].find((v) => typeof v === "string" && v.trim()) || "";
  }, [categories, items]);

  return { items: visible, grouped, loading, error, reload: load, categoryImage, categoryIcon, categoryMeta };
}

export const isImageUrl = (s) => typeof s === "string" && /^(https?:\/\/|data:image\/|blob:|\/)/i.test(s);

// ── Display helpers (pure — no pricing logic, just what the card shows) ──
export const isOutOfStock = (it) => Boolean(it.stockTracked && !it.stockAvailable);
export const discountPct = (it) => {
  const op = Number(it.originalPrice) || 0, p = Number(it.price) || 0;
  return op > p ? Math.round((1 - p / op) * 100) : 0;
};
export const rankItems = (list) =>
  [...list].sort((a, b) =>
    (isOutOfStock(a) - isOutOfStock(b)) ||
    ((Number(b.rating) || 0) - (Number(a.rating) || 0)) ||
    (!!b.image - !!a.image));
