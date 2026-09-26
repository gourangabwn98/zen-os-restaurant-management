import { useState } from "react";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { useMenu } from "../hooks/useMenu.js";
import SearchRow from "../components/SearchRow.jsx";
import CategoryTiles from "../components/CategoryTiles.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import { MenuSkeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState, ErrorState } from "../components/StateViews.jsx";
import Button from "../components/ui/Button.jsx";

/** Full menu — search + veg filter (server-side, as before), category discs
 * that narrow the list, and every category as its own 2-column section. */
export default function MenuPage() {
  const { state } = useLocation();
  const { cart, filters } = useAppState();
  const { grouped, loading, error, reload, categoryImage, items } = useMenu({ search: filters.search, diet: filters.diet });
  const [openItem, setOpenItem] = useState(null);

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };

  const names = grouped.map(([c]) => c);
  // A category picked earlier may disappear under a new search/filter.
  const activeCat = filters.category === "All" || names.includes(filters.category) ? filters.category : "All";
  const sections = activeCat === "All" ? grouped : grouped.filter(([c]) => c === activeCat);
  const filtering = Boolean(filters.search) || filters.diet !== "all" || activeCat !== "All";

  return (
    <>
      <SearchRow
        search={filters.search} onSearch={filters.setSearch}
        diet={filters.diet} onDiet={filters.setDiet} autoFocus={Boolean(state?.focusSearch)}
      />

      {names.length > 0 && (
        <CategoryTiles
          names={names} active={activeCat} onPick={filters.setCategory} imageFor={categoryImage}
        />
      )}

      {loading && !items && <MenuSkeleton />}
      {!loading && error && !items && <ErrorState message={error} onRetry={reload} />}

      {items && sections.length === 0 && (
        <EmptyState
          icon="🔍"
          title={filters.search ? `Nothing matches “${filters.search}”` : "No items found"}
          sub="Try a different search or category"
          action={filtering && <Button variant="ghost" onClick={filters.reset}>Clear filters</Button>}
        />
      )}

      {items && sections.map(([cat, list]) => (
        <section key={cat} aria-label={cat}>
          <div className="sec-h">
            <h3>{cat}</h3>
            <span className="muted small nowrap">{list.length} item{list.length > 1 ? "s" : ""}</span>
          </div>
          <div className="grid">
            {list.map((item) => (
              <ItemCard
                key={item._id} item={item} qty={cart.getQty(item._id)} onOpen={setOpenItem}
                onAdd={(i) => handleAdd(i, 1)} onInc={(i) => cart.addItem(i, 1)} onDec={(i) => cart.removeItem(i._id)}
              />
            ))}
          </div>
        </section>
      ))}

      {openItem && <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />}
    </>
  );
}
