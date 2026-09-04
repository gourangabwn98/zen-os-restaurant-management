import { useEffect, useState } from "react";

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
        position: "relative", width: "100%", height: 140, borderRadius: 16,
        overflow: "hidden", background: "#eee",
      }}>
        <div style={{
          display: "flex", height: "100%", transition: "transform .4s ease",
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
              <div key={i} style={{ width: `${100 / active.length}%`, flexShrink: 0, height: "100%" }}>
                {b.link ? <a href={b.link} target="_blank" rel="noreferrer">{img}</a> : img}
              </div>
            );
          })}
        </div>

        {active.length > 1 && (
          <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
            {active.map((_, i) => (
              <div key={i} style={{
                width: i === slide ? 16 : 6, height: 6, borderRadius: 3,
                background: i === slide ? "#fff" : "rgba(255,255,255,0.5)", transition: "width .3s",
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
