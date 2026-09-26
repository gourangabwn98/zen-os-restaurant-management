import { useEffect, useRef, useState } from "react";
import Icon from "./ui/Icon.jsx";

/** Home hero carousel (reference ".hero"). Slides:
 *  1. intro slide (CTA → full menu), 2. every active admin banner as a
 *  full-bleed photo slide (its link preserved), 3. when there are no
 *  banners, the top-rated dishes as "Chef's pick" slides with an Add CTA. */
export default function BannerCarousel({ banners, picks = [], tableLabel, onBrowse, onAdd }) {
  const active = (banners || []).filter((b) => b.active && b.imageUrl);
  const slides = [
    { kind: "intro", img: picks[0]?.image },
    ...active.map((b) => ({ kind: "banner", ...b })),
    ...(active.length ? [] : picks.slice(0, 2).map((it) => ({ kind: "item", item: it }))),
  ];

  const [slide, setSlide] = useState(0);
  const touchX = useRef(null);
  const count = slides.length;
  const go = (i) => setSlide(((i % count) + count) % count);

  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => { if (!document.hidden) setSlide((p) => (p + 1) % count); }, 5000);
    return () => clearInterval(id);
  }, [count]);

  useEffect(() => { if (slide >= count) setSlide(0); }, [slide, count]);

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
            <div key={`s${i}`} className="slide" aria-hidden={hidden}>
              <div style={{ minWidth: 0 }}>
                <span className="pill">{item ? "Chef's pick" : tableLabel ? `${tableLabel} · Dine-in` : "Hot & fresh"}</span>
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
