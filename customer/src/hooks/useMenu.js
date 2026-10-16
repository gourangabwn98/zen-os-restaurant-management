import { useEffect, useState, useCallback, useMemo } from "react";
import { getMenu, getMenuCategories, getMenuStructure } from "../services/menuService.js";
import { getSocket } from "../services/socketService.js";
import { SIGNATURE_LABEL } from "../utils/menuDisplay.js";

// Last response per query — lets Home/Menu/Offers render instantly when
// the customer switches tabs, while a fresh fetch runs in the background.
const cache = new Map();
let categoriesCache = null;
let structureCache = null;
// Schedules are minute-granular, so a 1-minute poll keeps a time window
// opening/closing on time; admin edits arrive instantly via "menu:updated".
const MENU_REFRESH_MS = 60 * 1000;

// Customer-only highlight tabs, shown before the menu sections (the waiter
// app lists sections only). Each dish also stays in its own section.
//   Khoai Signature — dishes the admin marked "Khoai Signature" (isChefsPick)
//   Popular         — dishes the admin marked "Most Popular", plus the real
//                     top sellers the server computes ("Most Ordered")
export const SPECIAL_TABS = [
  { name: SIGNATURE_LABEL, icon: "chef", test: (it) => it.isChefsPick === true },
  { name: "Popular", icon: "flame", test: (it) => it.isMostPopular === true || (it.categoryList || []).includes("Most Ordered") },
];
const specialTab = (name) => SPECIAL_TABS.find((t) => t.name === name) || null;
export const isSpecialTab = (name) => Boolean(specialTab(name));

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
  const [structure, setStructure] = useState(structureCache || []);

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
    getMenuStructure()
      .then(({ data }) => {
        structureCache = Array.isArray(data?.sections) ? data.sections : [];
        if (!stale) setStructure(structureCache);
      })
      .catch(() => {}); // chips then follow the items' own order
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

  // Timed categories (Menu times) open and close during the day (the server
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
    return diet === "nonveg" ? items.filter((it) => it.tag === "Non Veg") : items;
  }, [items, diet]);

  // The menu's sections: each item under its own section (`category`) only.
  // The automatic lists (Khoai Signature, Most Ordered, Today's Special…) are
  // not sections — the home screen shows those as banners / badges.
  // Order = the configured section order from GET /menu/structure (server
  // config, never database order), then the saved category order, then API order.
  const grouped = useMemo(() => {
    if (!visible) return [];
    const map = new Map();
    for (const it of visible) {
      const c = it.category || "Other";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(it);
    }
    const configured = new Map(structure.map((s, i) => [s.name, i]));
    const saved = new Map(categories.map((c, i) => [c.category, i]));
    const rank = (n) => configured.get(n) ?? 1e3 + (saved.get(n) ?? 1e3);
    const sections = [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
    // Highlight tabs first — only when they have something to show.
    const specials = SPECIAL_TABS.map((t) => [t.name, visible.filter(t.test)]).filter(([, list]) => list.length);
    return [...specials, ...sections];
  }, [visible, categories, structure]);

  /** MNU-06: the category's icon key (server: own pick → smart default → name guess). */
  const categoryIcon = useCallback((name) => specialTab(name)?.icon || categories.find((x) => x.category === name)?.icon || "plate", [categories]);
  /** Bengali name an admin gave the category, if any (display only). */
  const categoryMeta = useCallback((name) => categories.find((x) => x.category === name) || null, [categories]);

  // Returns an image URL, else the category's emoji placeholder (legacy
  // `image` values like "🍔"), else "". Emoji must never reach an <img src>.
  const categoryImage = useCallback((name) => {
    if (specialTab(name)) return ""; // highlight tabs always show their own icon
    const c = categories.find((x) => x.category === name);
    // Built-in (smart) categories show their own picture or their icon, not a random dish.
    if (c?.kind === "SMART") return isImageUrl(c.categoryImageUrl) ? c.categoryImageUrl : "";
    const inCat = (items || []).filter((m) => (m.categoryList || [m.category]).includes(name));
    const url = [c?.categoryImageUrl, c?.categoryImage, ...inCat.map((m) => m.categoryImage), ...inCat.map((m) => m.image)]
      .find(isImageUrl);
    if (url) return url;
    return [c?.categoryImage, ...inCat.map((m) => m.categoryImage)].find((v) => typeof v === "string" && v.trim()) || "";
  }, [categories, items]);

  /** Subcategory chips for a section: the configured order from
   * /menu/structure, only those with an item in the current view, with counts. */
  const subcategoriesFor = useCallback((section, list) => {
    if (specialTab(section)) return []; // mixed sections — no subcategory chips
    const counts = new Map();
    for (const it of list || []) {
      const s = String(it.subcategory || "").trim();
      if (s) counts.set(s, (counts.get(s) || 0) + 1);
    }
    const order = structure.find((s) => s.name === section)?.subcategories?.map((s) => s.name) || [];
    const rank = (n) => { const i = order.indexOf(n); return i === -1 ? 1e6 : i; };
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([name, count]) => ({ name, count }));
  }, [structure]);

  return { items: visible, grouped, loading, error, reload: load, categoryImage, categoryIcon, categoryMeta, subcategoriesFor };
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
