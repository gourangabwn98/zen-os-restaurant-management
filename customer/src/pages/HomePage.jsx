import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { useMenu, isOutOfStock, discountPct, rankItems } from "../hooks/useMenu.js";
import { useMyOrders } from "../hooks/useMyOrders.js";
import { useRestaurantProfile } from "../hooks/useRestaurantProfile.js";
import { isActiveOrder, STATUS_LABEL } from "../utils/orderStatus.js";
import SearchRow from "../components/SearchRow.jsx";
import BannerCarousel from "../components/BannerCarousel.jsx";
import CategoryTiles from "../components/CategoryTiles.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import StatusStepper from "../components/StatusStepper.jsx";
import { MenuSkeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState, ErrorState } from "../components/StateViews.jsx";
import Icon from "../components/ui/Icon.jsx";

export default function HomePage() {
  const nav = useNavigate();
  const { cart, table, filters } = useAppState();
  const profile = useRestaurantProfile();
  const { items, grouped, loading, error, reload, categoryImage } = useMenu({ diet: filters.diet });
  const { orders } = useMyOrders();
  const [openItem, setOpenItem] = useState(null);

  const handleAdd = (item, qty = 1, notes = "") => {
    cart.addItem(item, qty, notes);
    toast.success(`${item.name} added to cart`);
  };
  const cardProps = (item) => ({
    item, qty: cart.getQty(item._id), onOpen: setOpenItem,
    onAdd: (i) => handleAdd(i, 1), onInc: (i) => cart.addItem(i, 1), onDec: (i) => cart.removeItem(i._id),
  });

  // Typing on Home jumps to the full menu with the query (reference behaviour).
  const onSearch = (q) => {
    filters.setSearch(q);
    if (q) { filters.setCategory("All"); nav("/menu", { state: { focusSearch: true } }); }
  };
  const pickCategory = (c) => { filters.setCategory(c); nav("/menu"); };

  const popular = useMemo(() => rankItems((items || []).filter((i) => !isOutOfStock(i))).slice(0, 8), [items]);
  const more    = useMemo(() => rankItems(items || []).filter((m) => !popular.includes(m)).slice(0, 6), [items, popular]);
  const deals   = useMemo(() => (items || []).filter((m) => !isOutOfStock(m) && discountPct(m) > 0)
    .sort((a, b) => discountPct(b) - discountPct(a)), [items]);
  const picks   = useMemo(() => popular.filter((i) => i.image).slice(0, 3), [popular]);
  const live    = (orders || []).filter(isActiveOrder).slice(0, 2);

  return (
    <>
      <SearchRow search={filters.search} onSearch={onSearch} diet={filters.diet} onDiet={filters.setDiet} />

      {live.map((o) => (
        <Link key={o._id} to={`/order/${o._id}`} className="live-card" aria-label={`Track order ${o.orderId}`}>
          <div className="live-head">
            <span className="pulse" /><b>Order #{o.orderId} · {STATUS_LABEL[o.status]}</b><span>Live</span>
          </div>
          <StatusStepper status={o.status} footer="Tap to track" />
        </Link>
      ))}

      {loading && !items && <MenuSkeleton withHero />}
      {!loading && error && !items && <ErrorState message={error} onRetry={reload} />}

      {items && (
        <>
          <BannerCarousel
            banners={profile?.banners} picks={picks} tableLabel={table.tableLabel}
            onBrowse={() => nav("/menu")} onAdd={(it) => handleAdd(it, 1)}
          />

          {grouped.length > 0 && (
            <CategoryTiles
              names={grouped.map(([c]) => c)} active="All"
              onPick={pickCategory} imageFor={categoryImage}
            />
          )}

          {items.length === 0 ? (
            <EmptyState icon="🔍" title="No dishes match this filter" sub="Try switching the veg / non-veg filter off." />
          ) : (
            <>
              <div className="sec-h">
                <h3>Popular Picks</h3>
                <Link to="/menu" className="link">View All <Icon name="arrow" /></Link>
              </div>
              <div className="rail">
                {popular.map((it) => <ItemCard key={it._id} {...cardProps(it)} context="popular" />)}
              </div>

              {deals.length > 0 && <PromoStrip deals={deals} />}

              {more.length > 0 && (
                <>
                  <div className="sec-h">
                    <h3>More to try</h3>
                    <Link to="/menu" className="link">Full menu <Icon name="arrow" /></Link>
                  </div>
                  <div className="grid">
                    {more.map((it) => <ItemCard key={it._id} {...cardProps(it)} />)}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {openItem && <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />}
    </>
  );
}

/** "Today's Deals" strip — items the admin priced below their original price. */
export function PromoStrip({ deals }) {
  const best = discountPct(deals[0]);
  const art = deals.find((d) => d.image) || deals[0];
  return (
    <section className="promo">
      <div className="tx">
        <div className="kick">Today's Deals 🔥</div>
        <h4>Up to {best}% OFF</h4>
        <p>On {deals.length} selected item{deals.length > 1 ? "s" : ""}</p>
        <Link to="/offers" className="btn-cta">Order Now<i><Icon name="arrow" /></i></Link>
      </div>
      <div className="art">
        {art.image ? <img src={art.image} alt="" loading="lazy" /> : <span className="emo">🍔</span>}
        <div className="seal"><div><b>{best}%</b><small>OFF</small></div></div>
      </div>
    </section>
  );
}
