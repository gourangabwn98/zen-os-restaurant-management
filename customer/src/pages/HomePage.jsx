import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getMenu } from "../services/menuService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { useAppState } from "../context/AppState.jsx";
import BannerCarousel from "../components/BannerCarousel.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import TableBadge from "../components/TableBadge.jsx";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";
import IconLabelButton from "../components/ui/IconLabelButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import {
  ACCENT, ACCENT_GRADIENT, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT,
} from "../theme.js";

// Height of the sticky category tab bar — sections get this as
// scroll-margin-top so a jump-scroll doesn't tuck the heading under it,
// and the scroll-spy observer offsets by the same amount.
const TABS_BAR_HEIGHT = 56;

export default function HomePage() {
  const nav = useNavigate();
  const { cart, table, auth, favorites } = useAppState();

  const [profile, setProfile]   = useState(null);
  const [items, setItems]       = useState(null); // null = not loaded yet
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);

  const [search, setSearch]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [vegOnly, setVegOnly]   = useState(false);
  const [openItem, setOpenItem] = useState(null);
  const [activeCategory, setActiveCategory] = useState("");

  const sectionRefs = useRef({});
  const topRef = useRef(null);

  useEffect(() => {
    getRestaurantProfile().then(({ data }) => setProfile(data?.data || null)).catch(() => {});
  }, []);

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  // Zomato-style browsing: load the whole (filtered) menu at once and let
  // the customer scroll through every category on one page — category tabs
  // jump/highlight instead of re-fetching per category.
  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    getMenu({
      search: debouncedSearch || undefined,
      vegOnly: vegOnly ? "true" : undefined,
    })
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load the menu"))
      .finally(() => setLoading(false));
  }, [debouncedSearch, vegOnly]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const grouped = useMemo(() => {
    if (!items) return [];
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category).push(it);
    }
    return [...map.entries()];
  }, [items]);

  // Scroll-spy: highlight whichever category section is currently under
  // the sticky tab bar.
  useEffect(() => {
    if (!grouped.length) return;
    setActiveCategory((prev) => (grouped.some(([c]) => c === prev) ? prev : grouped[0][0]));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveCategory(top.target.dataset.category);
      },
      { rootMargin: `-${TABS_BAR_HEIGHT + 8}px 0px -70% 0px`, threshold: 0 }
    );
    grouped.forEach(([cat]) => {
      const el = sectionRefs.current[cat];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [grouped]);

  const jumpTo = (cat) => {
    if (!cat) { topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    sectionRefs.current[cat]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  const firstName = (auth.user?.name || "").split(" ")[0];

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 16 }} ref={topRef}>
      {/* ── Header ── */}
      <div style={{ padding: "18px 16px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
          {profile?.restaurantName || "Menu"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <IconLabelButton icon="❤️" label="Favorites" onClick={() => nav("/favorites")} active={favorites.count > 0} />
          <IconLabelButton icon="👤" label="Profile" onClick={() => nav("/profile")} />
        </div>
      </div>

      {/* ── Greeting / hero ── */}
      <div style={{ padding: "10px 16px 4px" }}>
        <div style={{ fontSize: 13, color: TEXT_MUTED, fontWeight: 600 }}>
          Hi, {firstName || "there"} 👋
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginTop: 4, lineHeight: 1.2 }}>
          Good Food <span style={{ color: ACCENT }}>Good Mood!</span>
        </div>
        {table.isDineIn
          ? <div style={{ marginTop: 10 }}><TableBadge label={table.tableLabel} onClear={table.clearTable} /></div>
          : <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 6 }}>Order for takeaway, or scan your table's QR</div>}
      </div>

      <BannerCarousel banners={profile?.banners} />

      {/* ── Search ── */}
      <div style={{ padding: "14px 16px 4px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, background: GLASS_BG,
          border: `1px solid ${GLASS_BORDER}`, borderRadius: 18, padding: "13px 16px",
          backdropFilter: "blur(20px)",
        }}>
          <span style={{ fontSize: 16, opacity: 0.7 }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dishes…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", color: "#fff" }}
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" style={{ border: "none", background: "none", color: TEXT_FAINT, fontSize: 14, cursor: "pointer" }}>✕</button>
          )}
        </div>

        {/* Always visible, not tucked behind an icon — this is the one
            filter this menu has, so there's nothing to "discover". */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button
            onClick={() => setVegOnly((v) => !v)}
            aria-pressed={vegOnly}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 20,
              border: `1.5px solid ${vegOnly ? "#34D399" : GLASS_BORDER}`,
              background: vegOnly ? "rgba(52,211,153,0.12)" : GLASS_BG,
              color: vegOnly ? "#34D399" : TEXT_MUTED, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            <span style={{ width: 13, height: 13, border: "1.5px solid #34D399", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D399" }} />
            </span>
            {vegOnly ? "Showing Veg only" : "Show Veg only"}
          </button>
        </div>
      </div>

      {/* ── Sticky category tabs — Zomato-style jump + scroll-spy ── */}
      {grouped.length > 0 && (
        <div
          className="hide-scrollbar"
          style={{
            position: "sticky", top: 0, zIndex: 20, display: "flex", gap: 10, overflowX: "auto",
            padding: "12px 16px", marginTop: 10, height: TABS_BAR_HEIGHT, alignItems: "center",
            background: "rgba(8,7,12,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            borderBottom: `1px solid ${GLASS_BORDER}`,
          }}
        >
          {grouped.map(([cat]) => (
            <Chip key={cat} active={activeCategory === cat} onClick={() => jumpTo(cat)}>
              {cat}
            </Chip>
          ))}
        </div>
      )}

      {/* ── Menu ── */}
      <div style={{ padding: "8px 16px 0" }}>
        {loading && <Loader skeleton />}
        {!loading && error && <ErrorState message={error} onRetry={loadMenu} />}
        {!loading && !error && grouped.length === 0 && (
          <EmptyState icon="🔎" title="No items found" sub="Try a different search or category" />
        )}
        {!loading && !error && grouped.map(([cat, catItems]) => (
          <div
            key={cat}
            ref={(el) => { sectionRefs.current[cat] = el; }}
            data-category={cat}
            style={{ marginBottom: 22, scrollMarginTop: TABS_BAR_HEIGHT + 8 }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.3, padding: "6px 2px 14px" }}>
              {cat}
            </div>
            <div className="menu-grid">
              {catItems.map((item) => (
                <ItemCard
                  key={item._id}
                  item={item}
                  qty={cart.getQty(item._id)}
                  onOpen={setOpenItem}
                  onAdd={(i) => handleAdd(i, 1)}
                  onInc={(i) => cart.addItem(i, 1)}
                  onDec={(i) => cart.removeItem(i._id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {openItem && (
        <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />
      )}

      {/* ── Floating cart bar ── */}
      {cart.itemCount > 0 && (
        <button
          onClick={() => nav("/cart")}
          className="floating-bar"
          style={{
            position: "fixed", left: 16, right: 16, bottom: NAV_HEIGHT + 14, zIndex: 30,
            background: ACCENT_GRADIENT, color: "#fff", border: "none", borderRadius: 18,
            padding: "15px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
            fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 12px 28px rgba(255,138,0,0.45)",
          }}
        >
          <span>{cart.itemCount} item{cart.itemCount > 1 ? "s" : ""} · ₹{cart.subtotal}</span>
          <span>View Cart →</span>
        </button>
      )}
    </div>
  );
}
