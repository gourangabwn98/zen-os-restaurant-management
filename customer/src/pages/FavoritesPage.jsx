import { useEffect, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { getMenu } from "../services/menuService.js";
import { useAppState } from "../context/AppState.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";
import { NAV_HEIGHT } from "../theme.js";

// Client-only feature — favorites are never sent to the backend, so we
// just load the full real menu and filter to the favorited ids locally.
export default function FavoritesPage() {
  const { cart, favorites } = useAppState();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openItem, setOpenItem] = useState(null);

  const load = () => {
    setError(null);
    getMenu({}).then(({ data }) => setItems(Array.isArray(data) ? data : [])).catch(() => setError("Couldn't load your favorites"));
  };

  useEffect(() => { load(); }, []);

  const favoriteItems = useMemo(
    () => (items || []).filter((it) => favorites.isFavorite(it._id)),
    [items, favorites.ids]
  );

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 16 }}>
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Your Favorites</div>

      <div style={{ padding: "8px 16px" }}>
        {items === null && !error && <Loader skeleton />}
        {error && <ErrorState message={error} onRetry={load} />}
        {items !== null && !error && favoriteItems.length === 0 && (
          <EmptyState icon="🤍" title="No favorites yet" sub="Tap the heart on any dish to save it here" />
        )}
        {items !== null && !error && favoriteItems.length > 0 && (
          <div className="menu-grid">
            {favoriteItems.map((item) => (
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
        )}
      </div>

      {openItem && (
        <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />
      )}
    </div>
  );
}
