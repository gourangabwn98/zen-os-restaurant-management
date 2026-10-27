// src/pages/admin/shared/OrderMenuPicker.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The menu half of "New order" and "Add items to order" (OrdersPage.jsx):
// category rail (photo + name + count) → subcategory chips → dish tiles.
//
// Built for a manager taking an order at the counter, often in a rush:
//   • Categories in the restaurant's own menu order (GET /menu/structure —
//     the server's section config), each with its photo, so the eye finds
//     "Main Course" by picture before reading. No emoji placeholders: a
//     category without a photo shows a dish photo from it, else its icon.
//   • Inside a category, subcategory chips (Paneer · Chicken · Mutton …) with
//     counts, one at a time, pinned above the dishes while scrolling.
//   • With no chip picked, dishes sit under subcategory headings, the way the
//     printed menu reads — scanning is faster than one long grid.
//   • Search always looks across the whole menu (category ignored), so typing
//     "kosha" never says "no items" because the wrong category was open.
//   • Each tile: tap anywhere on it to add; − / + appear once it is in the
//     order; the count badge sits on the photo. Name shows its portion
//     ("Boiled Egg (2 pcs)"), the veg / non-veg mark, Khoai Signature, add-on.
//   • Sold-out (out of stock) dishes stay visible but can't be added.
// Prices are a preview; the server prices every order.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, tn, fmtNum, localName } from "../../../i18n/core.js";
import CategoryIcon from "../../../components/CategoryIcon.jsx";
import { AddonHint } from "./AddonUI.jsx";
import { nameWithSize, subcategoryChips } from "../menu/menuKit.js";
import { MinusIcon, PlusIcon } from "./OrderScreen.jsx";
import { BEVERAGES_SECTION, drinkTemp } from "./drinkTemp.js";

const isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
const clean = (s) => String(s || "").trim();
const outOfStock = (m) => m.stockTracked === true && m.stockAvailable === false;
const VEG_FILTERS = [["All", "All"], ["Veg", "Veg"], ["Non Veg", "Non-veg"]];
// Beverages show Hot / Cold instead (drinks are almost all veg) — shared/drinkTemp.js.
const TEMP_FILTERS = [["All", "All"], ["Hot", "Hot"], ["Cold", "Cold"]];

/** Glide the pressed button of a sideways / vertical row into view. */
const useKeepActiveVisible = (dep) => {
  const ref = useRef(null);
  useEffect(() => {
    const row = ref.current;
    const el = row?.querySelector('[aria-pressed="true"]');
    if (!row || !el) return;
    const horizontal = row.scrollWidth > row.clientWidth + 1;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "auto" : "smooth";
    if (horizontal) row.scrollTo({ left: Math.max(0, el.offsetLeft - row.offsetLeft - (row.clientWidth - el.clientWidth) / 2), behavior });
    else row.scrollTo({ top: Math.max(0, el.offsetTop - row.offsetTop - (row.clientHeight - el.clientHeight) / 2), behavior });
  }, [dep]);
  return ref;
};

function VegMark({ tag }) {
  if (tag === "Others") return null;
  const veg = tag === "Veg";
  return <span className={`omp-veg${veg ? "" : " nv"}`} role="img" aria-label={veg ? t("Veg") : t("Non-veg")}><i /></span>;
}

/**
 * @param items      menu items (GET /menu)
 * @param loading    menu still loading
 * @param search     the modal's search text (searches the whole menu)
 * @param cats       Category records (GET /categories): image, nameBn, iconShown
 * @param sectionOrder section names in the configured order (GET /menu/structure)
 * @param getQty     (menuItemId) → qty in the order being built
 * @param onAdd      (item) → add one (asks about add-ons when it has some)
 * @param onRemove   (menuItemId) → take one off
 */
export default function OrderMenuPicker({ items = [], loading, search = "", cats = [], sectionOrder = [], getQty, onAdd, onRemove }) {
  const [picked, setCat] = useState("All");
  const [sub, setSub] = useState(null);
  const [veg, setVeg] = useState("All");
  const [temp, setTemp] = useState("All");
  const listRef = useRef(null);
  // (railRef / cat are set up once the sections are known, below)
  const chipsRef = useKeepActiveVisible(sub);
  const q = clean(search).toLowerCase();

  const catByName = useMemo(() => new Map(cats.map((c) => [c.name, c])), [cats]);
  const label = useCallback((name) => localName(catByName.get(name) || { name }), [catByName]);

  // Sections that have dishes, in the configured menu order; anything else after.
  const sections = useMemo(() => {
    const counts = new Map();
    for (const m of items) if (m.category) counts.set(m.category, (counts.get(m.category) || 0) + 1);
    const rank = (n) => { const i = sectionOrder.indexOf(n); return i === -1 ? 1e3 : i; };
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [items, sectionOrder]);

  // A category picked earlier may be gone after a menu refresh → "All".
  const cat = picked !== "All" && !sections.some((s) => s.name === picked) ? "All" : picked;
  const railRef = useKeepActiveVisible(cat);
  const pickCat = (name) => { setCat(name); setSub(null); listRef.current?.scrollTo({ top: 0 }); };
  const pickSub = (name) => { setSub((cur) => (cur === name ? null : name)); listRef.current?.scrollTo({ top: 0, behavior: "smooth" }); };

  // Photo for a category: its own picture, else a dish photo from it; null → icon.
  const photoOf = useMemo(() => {
    const m = new Map();
    for (const s of sections) {
      const own = catByName.get(s.name)?.image;
      m.set(s.name, isUrl(own) ? own : items.find((i) => i.category === s.name && isUrl(i.image))?.image || null);
    }
    return m;
  }, [sections, catByName, items]);
  const iconOf = (name) => catByName.get(name)?.iconShown || catByName.get(name)?.icon || "plate";

  const searching = q.length > 0;
  const drinks = cat === BEVERAGES_SECTION && !searching;
  const inCat = useMemo(() => (cat === "All" ? items : items.filter((m) => m.category === cat)), [items, cat]);
  const subs = useMemo(() => (searching || cat === "All" ? [] : subcategoryChips(inCat)), [inCat, cat, searching]);
  const activeSub = subs.some((s) => s.name === sub) ? sub : null;

  const shown = useMemo(() => {
    const base = searching ? items : inCat;
    return base.filter((m) => {
      if (drinks ? temp !== "All" && drinkTemp(m) !== temp : veg !== "All" && m.tag !== veg) return false;
      if (activeSub && clean(m.subcategory) !== activeSub) return false;
      if (!searching) return true;
      return [m.name, m.nameBn, m.itemId, m.subcategory].some((v) => clean(v).toLowerCase().includes(q));
    });
  }, [items, inCat, searching, q, veg, temp, drinks, activeSub]);

  // Headings: across the menu → by category; inside one → by subcategory.
  const groups = useMemo(() => {
    if (cat === "All" || searching) {
      return sections.map((s) => [label(s.name), shown.filter((m) => m.category === s.name)]).filter(([, l]) => l.length);
    }
    if (activeSub || subs.length < 2) return [[null, shown]];
    const out = subs.map((s) => [s.name, shown.filter((m) => clean(m.subcategory) === s.name)]).filter(([, l]) => l.length);
    const rest = shown.filter((m) => !clean(m.subcategory));
    if (rest.length) out.push([t("More"), rest]);
    return out;
  }, [cat, searching, sections, shown, activeSub, subs, label]);

  const railTile = (name, count, active, visual) => (
    <button key={name} type="button" className="omp-cat" aria-pressed={active} onClick={() => pickCat(name)}
      title={name === "All" ? t("All") : label(name)}>
      <span className="omp-cat-ph">{visual}</span>
      <span className="omp-cat-nm">{name === "All" ? t("All") : label(name)}</span>
      <span className="omp-cat-n">{fmtNum(count)}</span>
    </button>
  );

  return (
    <>
      <OmpStyles />
      {/* ── Category rail ── */}
      <nav ref={railRef} className="op-scroll omp-rail" aria-label={t("Categories")}>
        {railTile("All", items.length, cat === "All" && !searching, <CategoryIcon name="thali" size={22} />)}
        {sections.map((s) => railTile(s.name, s.count, cat === s.name && !searching,
          photoOf.get(s.name)
            ? <img src={photoOf.get(s.name)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            : <CategoryIcon name={iconOf(s.name)} size={22} />))}
      </nav>

      {/* ── Dishes ── */}
      <div ref={listRef} className="op-scroll omp-main">
        <div className="omp-head">
          <div className="omp-title">
            <b>{searching ? t("Search results") : cat === "All" ? t("All items") : label(cat)}</b>
            <span>{tn(shown.length, "{n} item", "{n} items")}</span>
            {drinks ? (
              <div className="zc-seg omp-veg-seg" role="group" aria-label={t("Hot or cold")}>
                {TEMP_FILTERS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={temp === v} onClick={() => setTemp(v)}
                    className={temp === v ? `on${v === "Hot" ? " hot" : v === "Cold" ? " cold" : ""}` : ""}>
                    {v === "Hot" ? "🔥 " : v === "Cold" ? "🧊 " : ""}{t(l)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="zc-seg omp-veg-seg" role="group" aria-label={t("Food type")}>
                {VEG_FILTERS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={veg === v} onClick={() => setVeg(v)}
                    className={veg === v ? "on" : ""}>
                    {v !== "All" && <VegMark tag={v} />}{t(l)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {subs.length > 1 && (
            <div ref={chipsRef} className="omp-chips" role="toolbar" aria-label={t("Subcategory")}>
              <button type="button" className="omp-chip" aria-pressed={!activeSub} onClick={() => setSub(null)}>
                {t("All")}<span className="n">{fmtNum(inCat.length)}</span>
              </button>
              {subs.map((s) => (
                <button key={s.name} type="button" className="omp-chip" aria-pressed={activeSub === s.name} onClick={() => pickSub(s.name)}>
                  {s.name}<span className="n">{fmtNum(s.count)}</span>
                </button>
              ))}
            </div>
          )}
          {searching && <div className="omp-hint">{t("Searching the whole menu")}</div>}
        </div>

        {loading ? (
          <div className="omp-empty"><div className="zc-spin" style={{ margin: "0 auto 14px" }} />{t("Loading menu…")}</div>
        ) : shown.length === 0 ? (
          <div className="omp-empty">
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>{t("No items found")}</div>
            {drinks
              ? temp !== "All" && <button type="button" className="zc-btn sm ghost" onClick={() => setTemp("All")}>{t("Show all drinks")}</button>
              : veg !== "All" && <button type="button" className="zc-btn sm ghost" onClick={() => setVeg("All")}>{t("Show all food types")}</button>}
          </div>
        ) : groups.map(([heading, list]) => (
          <section key={heading || "_all"} className="omp-group">
            {heading && <h4 className="omp-gh"><span>{heading}</span><span className="n">{fmtNum(list.length)}</span></h4>}
            <div className="omp-grid">
              {list.map((m) => {
                const qty = getQty(m._id);
                const categoryOff = m.categoryOrderingEnabled === false;
                const off = outOfStock(m) || categoryOff;
                const name = nameWithSize(localName(m), m.size);
                return (
                  <div key={m._id} className={`omp-card${qty ? " in" : ""}${off ? " off" : ""}`}>
                    <button type="button" className="omp-tap" disabled={off} onClick={() => onAdd(m)}
                      aria-label={off ? `${name} — ${categoryOff ? t("Currently unavailable for ordering") : t("Out of stock")}` : t("Add {name}", { name })}>
                      <span className="omp-ph">
                        {isUrl(m.image)
                          ? <img src={m.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          : <CategoryIcon name={iconOf(m.category)} size={30} />}
                        {m.isChefsPick && <span className="omp-sig">{t("Khoai Signature")}</span>}
                        {qty > 0 && <span className="omp-q">{fmtNum(qty)}</span>}
                        {off && <span className="omp-oos">{categoryOff ? t("Currently unavailable for ordering") : t("Out of stock")}</span>}
                      </span>
                      <span className="omp-bd">
                        <span className="omp-nm"><VegMark tag={m.tag} />{name}</span>
                        {(m.subcategory && cat === "All") || searching
                          ? <span className="omp-sub">{[searching && label(m.category), m.subcategory].filter(Boolean).join(" · ")}</span>
                          : null}
                        {m.notShareableCategory && <span className="omp-warn">{t("{name} not shareable", { name: m.notShareableCategory })}</span>}
                        <AddonHint item={m} />
                      </span>
                    </button>
                    <div className="omp-ft">
                      <span className="omp-price tnum">₹{fmtNum(m.price)}</span>
                      {qty > 0 ? (
                        <span className="omp-step">
                          <button type="button" onClick={() => onRemove(m._id)} aria-label={t("Remove one {name}", { name })}><MinusIcon /></button>
                          <b className="tnum">{fmtNum(qty)}</b>
                          <button type="button" className="pri" disabled={off} onClick={() => onAdd(m)} aria-label={t("Add {name}", { name })}><PlusIcon /></button>
                        </span>
                      ) : (
                        <button type="button" className="omp-add" disabled={off} onClick={() => onAdd(m)}><PlusIcon size={13} />{t("Add")}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// Scoped styles (same token palette as the rest of the admin app).
const OmpStyles = () => (
  <style>{`
    .omp-rail { width: 148px; flex-shrink: 0; overflow-y: auto; padding: 10px 8px; display: flex; flex-direction: column; gap: 4px;
      background: var(--surface); border-right: 1px solid var(--edge); }
    .omp-cat { display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; column-gap: 9px; align-items: center;
      width: 100%; padding: 7px 8px; border: 1px solid transparent; border-radius: var(--r-ctl); background: transparent;
      cursor: pointer; text-align: left; color: var(--text-2); transition: background .15s ease, border-color .15s ease; }
    .omp-cat:hover { background: var(--card-2); }
    .omp-cat:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 1px; }
    .omp-cat-ph { grid-row: 1 / span 2; width: 44px; height: 44px; border-radius: 12px; overflow: hidden; display: grid; place-items: center;
      background: var(--card-2); color: var(--accent-ink); border: 1px solid var(--edge); }
    .omp-cat-ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .omp-cat-nm { font-size: 12.5px; font-weight: 650; line-height: 1.2; color: var(--text-1); overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
    .omp-cat-n { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
    .omp-cat[aria-pressed="true"] { background: var(--violet-weak); border-color: var(--violet-line); }
    .omp-cat[aria-pressed="true"] .omp-cat-ph { border-color: var(--accent-ink); box-shadow: 0 0 0 2px var(--violet-weak); }
    .omp-cat[aria-pressed="true"] .omp-cat-nm { color: var(--accent-ink); font-weight: 750; }

    .omp-main { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 16px 16px; }
    .omp-head { position: sticky; top: 0; z-index: 3; background: var(--card); margin: 0 -16px 6px; padding: 12px 16px 10px;
      border-bottom: 1px solid var(--edge); }
    .omp-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .omp-title b { font-size: 16px; font-weight: 750; color: var(--text-1); letter-spacing: -.01em; }
    .omp-title > span { font-size: 12px; color: var(--text-3); }
    .omp-veg-seg { margin-left: auto; }
    .omp-veg-seg button { display: inline-flex; align-items: center; gap: 6px; }
    .omp-veg-seg button.on { background: var(--grad-btn); color: #fff; font-weight: 600; }
    .omp-veg-seg button.on.hot { background: var(--wait-fill); color: var(--wait-ink); }
    .omp-veg-seg button.on.cold { background: var(--live-fill); color: var(--live-ink); }
    .omp-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-top: 10px; padding: 1px;
      -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); }
    .omp-chips::-webkit-scrollbar { display: none; }
    .omp-chip { flex: none; display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 7px 0 13px;
      border-radius: 999px; border: 1px solid var(--edge-hi); background: var(--card-2); color: var(--text-2);
      font-size: 12.5px; font-weight: 650; cursor: pointer; white-space: nowrap; transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .omp-chip:hover { border-color: var(--violet-line); color: var(--text-1); }
    .omp-chip .n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center;
      font-size: 10.5px; font-weight: 750; background: var(--card); color: var(--text-3); }
    .omp-chip[aria-pressed="true"] { background: var(--grad-btn); border-color: transparent; color: #fff; box-shadow: 0 4px 12px -4px var(--violet-glow); }
    .omp-chip[aria-pressed="true"] .n { background: rgba(255,255,255,.22); color: #fff; }
    .omp-chip:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
    .omp-hint { margin-top: 8px; font-size: 11.5px; color: var(--text-3); }

    .omp-group { margin-top: 12px; }
    .omp-gh { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; font-size: 13px; font-weight: 750; color: var(--text-1); }
    .omp-gh .n { font-size: 11px; font-weight: 650; color: var(--text-3); }
    .omp-gh::after { content: ""; flex: 1; height: 1px; background: var(--edge); }
    .omp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(176px, 100%), 1fr)); gap: 12px; }
    .omp-empty { text-align: center; padding: 56px 16px; color: var(--text-3); font-size: 13px; }

    .omp-card { display: flex; flex-direction: column; border: 1px solid var(--edge); border-radius: var(--r-card); background: var(--card-2);
      overflow: hidden; transition: border-color .15s ease, background .15s ease, transform .1s ease; }
    .omp-card:hover { border-color: var(--violet-line); }
    .omp-card.in { border-color: var(--violet-line); background: var(--violet-faint); }
    .omp-card.off { opacity: .55; }
    .omp-tap { all: unset; display: flex; flex-direction: column; flex: 1; cursor: pointer; }
    .omp-tap:disabled { cursor: not-allowed; }
    .omp-tap:active:not(:disabled) { transform: scale(.985); }
    .omp-tap:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -2px; }
    .omp-ph { position: relative; height: 104px; background: var(--card); display: grid; place-items: center; color: var(--text-3); overflow: hidden; }
    .omp-ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .omp-sig { position: absolute; left: 6px; top: 6px; font-size: 9.5px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase;
      padding: 3px 7px; border-radius: 999px; background: #F59E0B; color: #3B2300; }
    .omp-q { position: absolute; right: 6px; top: 6px; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center;
      background: var(--grad-btn); color: #fff; font-size: 12px; font-weight: 750; box-shadow: 0 4px 10px -4px var(--violet-glow); }
    .omp-oos { position: absolute; inset: auto 0 0 0; padding: 3px; text-align: center; font-size: 10.5px; font-weight: 750; color: #fff; background: rgba(0,0,0,.6); }
    .omp-bd { display: flex; flex-direction: column; gap: 3px; padding: 9px 10px 4px; }
    .omp-nm { font-size: 13px; font-weight: 650; line-height: 1.3; color: var(--text-1); overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .omp-nm .omp-veg { margin-right: 6px; vertical-align: -2px; }
    .omp-sub { font-size: 11px; color: var(--text-3); }
    .omp-warn { font-size: 11px; font-weight: 700; color: var(--stop-ink); }
    .omp-ft { display: flex; align-items: center; gap: 6px; padding: 4px 10px 10px; }
    .omp-price { font-size: 15px; font-weight: 750; color: var(--text-1); margin-right: auto; }
    .omp-add { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 999px; padding: 0 13px; height: 30px; font-size: 12.5px; font-weight: 700; cursor: pointer; line-height: 1;
      background: var(--grad-btn); color: #fff; box-shadow: 0 4px 10px -4px var(--violet-glow); }
    .omp-add:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
    .omp-step { display: inline-flex; align-items: center; gap: 6px; }
    .omp-step b { min-width: 18px; text-align: center; font-size: 14px; color: var(--text-1); }
    .omp-step button { width: 30px; height: 30px; padding: 0; border-radius: 50%; border: 1px solid var(--violet-line); background: var(--violet-weak);
      color: var(--accent-ink); cursor: pointer; display: inline-grid; place-items: center; line-height: 0; }
    .omp-step button:disabled { opacity: .5; cursor: not-allowed; }
    .omp-step button:focus-visible, .omp-add:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
    .omp-step button.pri { background: var(--grad-btn); color: #fff; border-color: transparent; }
    .omp-veg { width: 13px; height: 13px; border-radius: 3px; border: 1.5px solid var(--ready); display: inline-grid; place-items: center; flex: none; }
    .omp-veg i { width: 5px; height: 5px; border-radius: 50%; background: var(--ready); display: block; }
    .omp-veg.nv { border-color: var(--stop); }
    .omp-veg.nv i { background: var(--stop); }

    @media (min-width: 901px) and (max-width: 1200px) {
      .omp-rail { width: 120px; }
      .omp-cat { grid-template-columns: 1fr; justify-items: center; text-align: center; row-gap: 3px; padding: 7px 4px; }
      .omp-cat-ph { grid-row: auto; }
      .omp-grid { grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr)); }
    }
    @media (max-width: 900px) {
      .omp-rail { width: 100%; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--edge);
        padding: 8px 10px; gap: 6px; scrollbar-width: none; }
      .omp-rail::-webkit-scrollbar { display: none; }
      .omp-cat { flex: none; width: 76px; grid-template-columns: 1fr; grid-template-rows: auto auto auto; justify-items: center; text-align: center; padding: 6px 4px; row-gap: 3px; }
      .omp-cat-ph { grid-row: auto; width: 46px; height: 46px; }
      .omp-cat-nm { font-size: 11px; -webkit-line-clamp: 2; }
      .omp-main { padding: 0 12px 12px; }
      .omp-head { margin: 0 -12px 6px; padding: 10px 12px 8px; }
      .omp-veg-seg { margin-left: 0; }
      .omp-grid { grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr)); gap: 10px; }
      .omp-ph { height: 96px; }
    }
  `}</style>
);
