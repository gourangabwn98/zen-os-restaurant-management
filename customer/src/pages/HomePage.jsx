import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { useAppState } from "../context/AppState.jsx";
import BannerCarousel from "../components/BannerCarousel.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import TableBadge from "../components/TableBadge.jsx";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";
import { PINK, PINK_LIGHT, TEXT_MUTED, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

export default function HomePage() {
  const nav = useNavigate();
  const { cart, table } = useAppState();

  const [profile, setProfile]   = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems]       = useState(null); // null = not loaded yet
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);

  const [search, setSearch]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [vegOnly, setVegOnly]   = useState(false);
  const [openItem, setOpenItem] = useState(null);

  // Restaurant profile (banners) + categories — load once.
  useEffect(() => {
    getRestaurantProfile().then(({ data }) => setProfile(data?.data || null)).catch(() => {});
    getMenuCategories().then(({ data }) => setCategories(data || [])).catch(() => {});
  }, []);

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    getMenu({
      category: category || undefined,
      search: debouncedSearch || undefined,
      vegOnly: vegOnly ? "true" : undefined,
    })
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError("Couldn't load the menu"))
      .finally(() => setLoading(false));
  }, [category, debouncedSearch, vegOnly]);

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

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 12 }}>
      {/* ── Top bar ── */}
      <div style={{ padding: "16px 16px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{profile?.restaurantName || "Menu"}</div>
            {table.isDineIn
              ? <div style={{ marginTop: 6 }}><TableBadge label={table.tableLabel} onClear={table.clearTable} /></div>
              : <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>Order for takeaway, or scan your table's QR</div>}
          </div>
        </div>
      </div>

      <BannerCarousel banners={profile?.banners} />

      {/* ── Search ── */}
      <div style={{ padding: "10px 16px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, background: "#fff",
          border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px",
        }}>
          <span>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dishes…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "none", color: TEXT_FAINT, fontSize: 14, cursor: "pointer" }}>✕</button>
          )}
        </div>
      </div>

      {/* ── Category chips ── */}
      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 16px 12px" }}>
          <Chip active={!category} onClick={() => setCategory("")}>All</Chip>
          {categories.map((c) => (
            <Chip key={c.category} active={category === c.category} onClick={() => setCategory(c.category)}>
              {c.category}
            </Chip>
          ))}
        </div>
      )}

      {/* ── Veg toggle ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px 10px" }}>
        <button
          onClick={() => setVegOnly((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 20,
            border: `1.5px solid ${vegOnly ? "#16a34a" : BORDER}`,
            background: vegOnly ? "rgba(22,163,74,0.08)" : "#fff",
            color: vegOnly ? "#16a34a" : TEXT_MUTED, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >
          <span style={{ width: 12, height: 12, border: "1.5px solid #16a34a", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#16a34a" }} />
          </span>
          Veg only
        </button>
      </div>

      {/* ── Menu ── */}
      <div style={{ padding: "0 16px" }}>
        {loading && <Loader label="Loading menu…" />}
        {!loading && error && <ErrorState message={error} onRetry={loadMenu} />}
        {!loading && !error && grouped.length === 0 && (
          <EmptyState icon="🔎" title="No items found" sub="Try a different search or category" />
        )}
        {!loading && !error && grouped.map(([cat, catItems]) => (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, padding: "12px 0 4px" }}>
              {cat}
            </div>
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
        ))}
      </div>

      {openItem && (
        <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />
      )}

      {/* ── Floating cart bar ── */}
      {cart.itemCount > 0 && (
        <button
          onClick={() => nav("/cart")}
          style={{
            position: "fixed", left: 16, right: 16, bottom: NAV_HEIGHT + 12, zIndex: 30,
            background: PINK, color: "#fff", border: "none", borderRadius: 14,
            padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
            fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 8px 20px rgba(224,17,95,0.35)",
          }}
        >
          <span>{cart.itemCount} item{cart.itemCount > 1 ? "s" : ""} · ₹{cart.subtotal}</span>
          <span>View Cart →</span>
        </button>
      )}
    </div>
  );
}

const Chip = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      flexShrink: 0, padding: "7px 15px", borderRadius: 20, fontSize: 12.5, fontWeight: 700,
      border: `1.5px solid ${active ? PINK : BORDER}`,
      background: active ? PINK_LIGHT : "#fff", color: active ? PINK : TEXT_MUTED, cursor: "pointer",
    }}
  >
    {children}
  </button>
);
