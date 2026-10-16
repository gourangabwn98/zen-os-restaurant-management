import { useState, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { useMenu, isSpecialTab } from "../hooks/useMenu.js";
import SearchRow from "../components/SearchRow.jsx";
import CategoryTiles from "../components/CategoryTiles.jsx";
import ItemCard from "../components/ItemCard.jsx";
import ItemDetailSheet from "../components/ItemDetailSheet.jsx";
import { MenuSkeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState, ErrorState } from "../components/StateViews.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";
import SubcategoryBar from "../components/SubcategoryBar.jsx";

/** Full menu — search + veg filter (server-side, as before), section tabs
 * (category discs) that narrow the list, and inside a section a sticky
 * subcategory filter ("All" by default; one at a time). */
export default function MenuPage() {
  const { state } = useLocation();
  const { cart, filters } = useAppState();
  const { grouped, loading, error, reload, categoryImage, categoryIcon, items, subcategoriesFor } = useMenu({ search: filters.search, diet: filters.diet });
  const [openItem, setOpenItem] = useState(null);
  // The subcategory picked inside the open section (null = "All"); a new section starts at "All".
  const [chips, setChips] = useState({ section: null, sub: null });
  const listRef = useRef(null);

  const handleAdd = (item, qty = 1, notes = "", addonIds = []) => {
    cart.addItem(item, qty, notes, addonIds);
    toast.success(`${item.name} added to cart`);
  };

  const names = grouped.map(([c]) => c);
  // A category picked earlier may disappear under a new search/filter.
  const activeCat = filters.category === "All" || names.includes(filters.category) ? filters.category : "All";
  const sections = activeCat === "All" ? grouped : grouped.filter(([c]) => c === activeCat);
  const sectionItems = activeCat === "All" ? [] : sections[0]?.[1] || [];
  const subs = useMemo(() => (activeCat === "All" ? [] : subcategoriesFor(activeCat, sectionItems)), [activeCat, sectionItems, subcategoriesFor]);
  const picked = chips.section === activeCat && subs.some((s) => s.name === chips.sub) ? chips.sub : null;
  // Single select. After a pick, if the list has scrolled under the sticky
  // bar, bring its first dish back into view right below the bar.
  const pickSub = (name) => {
    setChips({ section: activeCat, sub: name });
    requestAnimationFrame(() => {
      const list = listRef.current;
      const bar = document.querySelector(".subbar");
      if (!list || !bar) return;
      const gap = list.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
      if (gap < 0) window.scrollBy({ top: gap - 8, behavior: "smooth" });
    });
  };
  // Inside a section: one block per subcategory (only the picked one, if
  // any), in menu order; dishes without a subcategory come last under "More".
  const blocks = useMemo(() => {
    if (activeCat === "All" || !subs.length) return null;
    const wanted = picked ? subs.filter((s) => s.name === picked) : subs;
    const out = wanted.map((s) => [s.name, sectionItems.filter((it) => String(it.subcategory || "").trim() === s.name)]);
    const loose = sectionItems.filter((it) => !String(it.subcategory || "").trim());
    if (!picked && loose.length) out.push(["More", loose]);
    return out;
  }, [activeCat, subs, picked, sectionItems]);
  const openSection = (cat) => { filters.setCategory(cat); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const filtering = Boolean(filters.search) || filters.diet !== "all" || activeCat !== "All";
  const card = (item) => (
    <ItemCard
      key={item._id} item={item} qty={cart.getQty(item._id)} onOpen={setOpenItem}
      onAdd={(i) => handleAdd(i, 1)} onInc={(i) => cart.incLine(i._id)} onDec={(i) => cart.removeItem(i._id)}
    />
  );

  return (
    <>
      <SearchRow
        search={filters.search} onSearch={filters.setSearch}
        diet={filters.diet} onDiet={filters.setDiet} autoFocus={Boolean(state?.focusSearch)}
      />

      {names.length > 0 && (
        <CategoryTiles
          names={names} active={activeCat} onPick={filters.setCategory} imageFor={categoryImage} iconFor={categoryIcon} isSpecial={isSpecialTab}
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

      {items && blocks && (
        <section aria-label={activeCat}>
          <div className="sec-h">
            <h3>{activeCat}</h3>
            <span className="muted small nowrap">{sectionItems.length} item{sectionItems.length > 1 ? "s" : ""}</span>
          </div>
          {subs.length > 1 && (
            <SubcategoryBar section={activeCat} total={sectionItems.length} options={subs} active={picked} onPick={pickSub} />
          )}
          <div ref={listRef}>
            {blocks.map(([sub, list]) => (
              <div key={sub} className="subgroup">
                {/* Headings only when several groups are on screen; a picked chip already names the one shown. */}
                {blocks.length > 1 && (
                  <h4 className="sub-h"><span>{sub}</span><span className="n">{list.length}</span></h4>
                )}
                <div className="grid">{list.map(card)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {items && !blocks && sections.map(([cat, list]) => (
        <section key={cat} aria-label={cat}>
          <div className="sec-h">
            <h3>{cat}</h3>
            {activeCat === "All" && sections.length > 1
              ? <button type="button" className="link" onClick={() => openSection(cat)}>See all {list.length} <Icon name="chevron" /></button>
              : <span className="muted small nowrap">{list.length} item{list.length > 1 ? "s" : ""}</span>}
          </div>
          <div className="grid">{list.map(card)}</div>
        </section>
      ))}

      {openItem && <ItemDetailSheet item={openItem} onClose={() => setOpenItem(null)} onAdd={handleAdd} />}
    </>
  );
}
