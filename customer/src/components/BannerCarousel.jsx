import { useEffect, useState } from "react";
import { GLASS_BORDER, ACCENT } from "../theme.js";

export default function BannerCarousel({ banners }) {
  const [slide, setSlide] = useState(0);
  const active = (banners || []).filter((b) => b.active && b.imageUrl);

  useEffect(() => {
    if (active.length < 2) return;
    const id = setInterval(() => setSlide((p) => (p + 1) % active.length), 4000);
    return () => clearInterval(id);
  }, [active.length]);

  if (!active.length) return null;

  return (
    <div style={{ padding: "12px 16px 4px" }}>
      <div style={{
        position: "relative", width: "100%", height: 160, borderRadius: 22,
        overflow: "hidden", border: `1px solid ${GLASS_BORDER}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)", background: "rgba(255,255,255,0.05)",
      }}>
        <div style={{
          display: "flex", height: "100%", transition: "transform .5s cubic-bezier(.4,0,.2,1)",
          transform: `translateX(-${slide * 100}%)`, width: `${active.length * 100}%`,
        }}>
          {active.map((b, i) => {
            const img = (
              <img
                src={b.imageUrl} alt="" loading={i === 0 ? "eager" : "lazy"}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            );
            return (
              <div key={i} style={{ width: `${100 / active.length}%`, flexShrink: 0, height: "100%", position: "relative" }}>
                {img}
                <div style={{
                  position: "absolute", inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
                }} />
                {b.link && (
                  <a href={b.link} target="_blank" rel="noreferrer" style={{ position: "absolute", inset: 0 }} aria-label="Open offer" />
                )}
              </div>
            );
          })}
        </div>

        {active.length > 1 && (
          <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
            {active.map((_, i) => (
              <div key={i} style={{
                width: i === slide ? 18 : 6, height: 6, borderRadius: 3,
                background: i === slide ? ACCENT : "rgba(255,255,255,0.4)", transition: "width .3s",
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
