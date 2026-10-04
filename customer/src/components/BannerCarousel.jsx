import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icon.jsx";

/** CUS-02 — the large auto-scrolling Home hero (reference ".hero"). Every
 * slide comes from real data; nothing is hard-coded:
 *   1. configured promotions — every active admin banner (its link kept),
 *   2. Today's Special / Chef's Picks / Fast Available — items the admin
 *      flagged in Menu items (MNU-05/04/03), up to 3 each,
 *   3. Best Seller — real top sellers (GET /api/menu/best-sellers),
 *   4. only when none of the above exist: an intro slide (CTA → menu).
 * Coupons have their own poster rail under the hero (CUS-03). */
const MAX_PER_GROUP = 3;

export default function BannerCarousel({ banners, specials = [], chefsPicks = [], fastItems = [], bestSellers = [], tableLabel, onBrowse, onAdd }) {
  const active = (banners || []).filter((b) => b.active && b.imageUrl);
  const itemSlides = (list, pill, kind) => list.slice(0, MAX_PER_GROUP).map((it) => ({ kind, item: it, pill }));
  const slides = [
    ...active.map((b) => ({ kind: "banner", ...b })),
    ...itemSlides(specials, "Today's Special", "special"),
    ...itemSlides(chefsPicks, "Chef's Pick", "chef"),
    ...itemSlides(fastItems, "Fast Available", "fast"),
    ...itemSlides(bestSellers, "Best Seller", "best"),
  ];
  if (!slides.length) slides.push({ kind: "intro" });

  const [rawSlide, setSlide] = useState(0);
  const touchX = useRef(null);
  const count = slides.length;
  // Banners can be removed while showing the last one — fall back to the first.
  const slide = rawSlide >= count ? 0 : rawSlide;
  const go = (i) => setSlide(((i % count) + count) % count);

  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => { if (!document.hidden) setSlide((p) => (p + 1) % count); }, 5000);
    return () => clearInterval(id);
  }, [count]);

  return (
    <section
      className="hero" aria-roledescription="carousel" aria-label="Highlights"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) go(slide + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className="slides" style={{ transform: `translateX(-${slide * 100}%)` }}>
        {slides.map((s, i) => {
          const hidden = i !== slide;
          if (s.kind === "banner") {
            return (
              <div key={`b${i}`} className="slide photo" aria-hidden={hidden}>
                <img src={s.imageUrl} alt="" loading={i < 2 ? "eager" : "lazy"} />
                {s.link && <a href={s.link} target="_blank" rel="noreferrer" aria-label="Open offer" tabIndex={hidden ? -1 : 0} />}
              </div>
            );
          }
          const item = s.item;
          return (
            <div key={`s${i}`} className={`slide${s.kind ? ` k-${s.kind}` : ""}`} aria-hidden={hidden}>
              <div style={{ minWidth: 0 }}>
                <span className="pill">{item ? s.pill : tableLabel ? `${tableLabel} · Dine-in` : "Hot & fresh"}</span>
                <h2>{item ? item.name : <>Crave it?<br />We’ll cook it.</>}</h2>
                <p>{item ? (item.description || item.category) : "Order from your phone. Straight to the kitchen — no waiting for the menu."}</p>
                <button type="button" className="btn-cta" tabIndex={hidden ? -1 : 0} onClick={() => (item ? onAdd(item) : onBrowse())}>
                  {item ? `Add · ₹${item.price}` : "Order Now"}<i><Icon name="arrow" /></i>
                </button>
              </div>
              <div className="img">
                {item?.image ? <img src={item.image} alt="" /> : <span className="emo">🍽️</span>}
              </div>
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="dots">
          {slides.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === slide} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </section>
  );
}
