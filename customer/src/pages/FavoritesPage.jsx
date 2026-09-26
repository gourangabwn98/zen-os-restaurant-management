import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { useMenu } from "../hooks/useMenu.js";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import { MenuSkeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState, ErrorState } from "../components/StateViews.jsx";

// Client-only feature — favorites are never sent to the backend, so we
// just load the full real menu and filter to the favorited ids locally.
export default function FavoritesPage() {
  const { cart, favorites } = useAppState();
  const { items, loading, error, reload } = useMenu();
  const [openItem, setOpenItem] = useState(null);

  const favoriteItems = useMemo(
    () => (items || []).filter((it) => favorites.isFavorite(it._id)),
    [items, favorites]
  );

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  return (
    <>
      <div className="page-h">
        <h2>Your favourites</h2>
        <p>Saved on this phone — tap the heart on any dish.</p>
      </div>

      {loading && !items && <MenuSkeleton />}
      {!loading && error && !items && <ErrorState message="Couldn't load your favorites" onRetry={reload} />}
      {items && favoriteItems.length === 0 && (
        <EmptyState
          icon="🤍" title="No favorites yet" sub="Tap the heart on any dish to save it here"
          action={<Link to="/menu" className="btn btn-primary">Browse menu</Link>}
        />
      )}
      {favoriteItems.length > 0 && (
        <div className="grid">
          {favoriteItems.map((item) => (
            <ItemCard
              key={item._id} item={item} qty={cart.getQty(item._id)} onOpen={setOpenItem}
              onAdd={(i) => handleAdd(i, 1)} onInc={(i) => cart.addItem(i, 1)} onDec={(i) => cart.removeItem(i._id)}
            />
          ))}
        </div>
      )}

      {openItem && <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />}
    </>
  );
}
