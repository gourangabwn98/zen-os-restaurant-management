import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icon.jsx";

const offerBig = (c) => (c.discountType === "PERCENT" ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`);
const validTill = (c) => {
  const d = new Date(c.endsAt);
  return `Valid till ${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

/** Home hero carousel (reference ".hero"). Slides, in order:
 *  1. intro slide (CTA → full menu),
 *  2. every active admin banner as a full-bleed photo slide (its link kept),
 *  3. "Best Seller" — real top sellers (GET /api/menu/best-sellers), Add CTA,
 *  4. "Today's Offer" — coupons live right now (GET /api/coupons; the server
 *     only returns ones inside their start/end time), CTA → Offers,
 *  5. only when there are no banners and no sales yet: "Chef's pick". */
export default function BannerCarousel({ banners, picks = [], bestSellers = [], offers = [], tableLabel, onBrowse, onAdd, onOffer }) {
  const active = (banners || []).filter((b) => b.active && b.imageUrl);
  const slides = [
    { kind: "intro", img: bestSellers.find((b) => b.image)?.image || picks[0]?.image },
    ...active.map((b) => ({ kind: "banner", ...b })),
    ...bestSellers.slice(0, 4).map((it) => ({ kind: "best", item: it })),
    ...offers.slice(0, 4).map((c) => ({ kind: "offer", coupon: c })),
    ...(active.length || bestSellers.length ? [] : picks.slice(0, 2).map((it) => ({ kind: "item", item: it }))),
  ];

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
          if (s.kind === "offer") {
            const c = s.coupon;
            return (
              <div key={`o${i}`} className="slide offer" aria-hidden={hidden}>
                <div style={{ minWidth: 0 }}>
                  <span className="pill">Today's Offer</span>
                  <h2>{c.title}</h2>
                  <p>{c.description || (c.minOrderAmount ? `On orders above ₹${c.minOrderAmount}` : "On your whole order")} · {validTill(c)}</p>
                  <button type="button" className="btn-cta" tabIndex={hidden ? -1 : 0} onClick={() => onOffer?.(c)}>
                    Use code {c.code}<i><Icon name="arrow" /></i>
                  </button>
                </div>
                <div className="img"><span className="offer-big">{offerBig(c)}</span></div>
              </div>
            );
          }
          const item = s.item;
          const pill = s.kind === "best" ? "Best Seller" : item ? "Chef's pick" : tableLabel ? `${tableLabel} · Dine-in` : "Hot & fresh";
          return (
            <div key={`s${i}`} className="slide" aria-hidden={hidden}>
              <div style={{ minWidth: 0 }}>
                <span className="pill">{pill}</span>
                <h2>{item ? item.name : <>Crave it?<br />We’ll cook it.</>}</h2>
                <p>{item ? (item.description || item.category) : "Order from your phone. Straight to the kitchen — no waiting for the menu."}</p>
                <button type="button" className="btn-cta" tabIndex={hidden ? -1 : 0} onClick={() => (item ? onAdd(item) : onBrowse())}>
                  {item ? `Add · ₹${item.price}` : "Order Now"}<i><Icon name="arrow" /></i>
                </button>
              </div>
              <div className="img">
                {(item?.image || s.img) ? <img src={item?.image || s.img} alt="" /> : <span className="emo">🍔</span>}
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
