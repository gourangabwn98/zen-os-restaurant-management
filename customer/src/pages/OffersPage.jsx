import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { useMenu, isOutOfStock, discountPct } from "../hooks/useMenu.js";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import { MenuSkeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState, ErrorState } from "../components/StateViews.jsx";
import { PromoStrip } from "./HomePage.jsx";

/** Items the restaurant has priced below their original price (admin-set
 * `originalPrice`). Prices shown are the live menu prices, nothing derived. */
export default function OffersPage() {
  const { cart } = useAppState();
  const { items, loading, error, reload } = useMenu();
  const [openItem, setOpenItem] = useState(null);

  const deals = useMemo(() => (items || [])
    .filter((m) => discountPct(m) > 0)
    .sort((a, b) => (isOutOfStock(a) - isOutOfStock(b)) || discountPct(b) - discountPct(a)), [items]);

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  return (
    <>
      <div className="page-h">
        <h2>Offers</h2>
        <p>Live prices from the restaurant — deals change through the day.</p>
      </div>

      {loading && !items && <MenuSkeleton />}
      {!loading && error && !items && <ErrorState message={error} onRetry={reload} />}

      {items && deals.length === 0 && (
        <EmptyState icon="🏷️" title="No offers right now" sub="Check back later — or try our Popular Picks on Home." />
      )}

      {deals.length > 0 && (
        <>
          <PromoStrip deals={deals.filter((d) => !isOutOfStock(d)).length ? deals.filter((d) => !isOutOfStock(d)) : deals} />
          <div className="sec-h"><h3>On offer now</h3></div>
          <div className="grid">
            {deals.map((item) => (
              <ItemCard
                key={item._id} item={item} qty={cart.getQty(item._id)} onOpen={setOpenItem}
                onAdd={(i) => handleAdd(i, 1)} onInc={(i) => cart.addItem(i, 1)} onDec={(i) => cart.removeItem(i._id)}
              />
            ))}
          </div>
        </>
      )}

      {openItem && <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />}
    </>
  );
}
