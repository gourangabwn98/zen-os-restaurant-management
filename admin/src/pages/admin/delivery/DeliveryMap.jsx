// src/pages/admin/delivery/DeliveryMap.jsx — restaurant, riders and drop
// points on one map. With a Google Maps key: a real map (utils/googleMaps.js).
// Without one: a to-scale schematic around the restaurant (1 km rings), and it
// says plainly that it is not a street map — never fake tiles.
import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps, hasMapsKey } from "../../../utils/googleMaps.js";
import { t } from "../../../i18n/core.js";

const COLORS = { restaurant: "#7c5cff", rider: "#10b981", riderStale: "#f59e0b", drop: "#ef4444" };
const valid = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

function GoogleMap({ points, height }) {
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const fitted = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive) return;
      if (!g || !box.current) { setFailed(true); return; }
      map.current = new g.Map(box.current, { zoom: 13, center: points.find(valid) || { lat: 22.57, lng: 88.36 }, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = window.google?.maps;
    if (!g || !map.current) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = points.filter(valid).map((p) => new g.Marker({
      map: map.current, position: { lat: p.lat, lng: p.lng }, title: p.label,
      label: p.kind === "rider" ? { text: "🛵", fontSize: "16px" } : p.kind === "restaurant" ? { text: "🍽", fontSize: "15px" } : undefined,
      icon: p.kind === "drop" ? { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: COLORS.drop, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } : undefined,
    }));
    if (!fitted.current && markers.current.length > 1) {
      const b = new g.LatLngBounds();
      markers.current.forEach((m) => b.extend(m.getPosition()));
      map.current.fitBounds(b, 48);
      fitted.current = true;
    }
  });

  if (failed) return <Schematic points={points} height={height} note={t("Google Maps couldn't load — check the API key. Showing a schematic instead.")} />;
  return <div ref={box} style={{ width: "100%", height, borderRadius: 12, border: "1px solid var(--edge)" }} />;
}

function Schematic({ points, height, note }) {
  const pts = points.filter(valid);
  const centre = pts.find((p) => p.kind === "restaurant") || pts[0];
  const layout = useMemo(() => {
    if (!centre) return null;
    const kx = 111320 * Math.cos((centre.lat * Math.PI) / 180), ky = 110540; // metres per degree
    const xy = pts.map((p) => ({ ...p, x: (p.lng - centre.lng) * kx, y: -(p.lat - centre.lat) * ky }));
    const span = Math.max(1000, ...xy.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.15;
    return { xy, span };
  }, [pts, centre]);
  if (!layout) return <div className="zc-empty" style={{ height }}>{t("No locations to show yet")}</div>;
  const { xy, span } = layout;
  const rings = Array.from({ length: Math.min(8, Math.floor(span / 1000)) }, (_, i) => (i + 1) * 1000);
  return (
    <div>
      <svg viewBox={`${-span} ${-span} ${span * 2} ${span * 2}`} style={{ width: "100%", height, background: "var(--card-2)", borderRadius: 12, border: "1px solid var(--edge)" }} role="img" aria-label={t("Schematic map of riders and deliveries")}>
        {rings.map((r) => (
          <g key={r}>
            <circle cx="0" cy="0" r={r} fill="none" stroke="var(--edge)" strokeDasharray={span / 80} strokeWidth={span / 400} />
            <text x={r * 0.71} y={-r * 0.71} fontSize={span / 30} fill="var(--text-3)">{r / 1000} km</text>
          </g>
        ))}
        {xy.map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={span / (p.kind === "restaurant" ? 28 : 40)} fill={COLORS[p.stale ? "riderStale" : p.kind]} stroke="#fff" strokeWidth={span / 300} />
            <text x={p.x + span / 30} y={p.y + span / 90} fontSize={span / 26} fill="var(--text-1)">{p.label}</text>
          </g>
        ))}
      </svg>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6 }}>
        {note || t("Schematic (to scale, no streets). Add a Google Maps key (config.js googleMapsKey) for the real map.")}
      </div>
    </div>
  );
}

export default function DeliveryMap({ points, height = 420 }) {
  return hasMapsKey() ? <GoogleMap points={points} height={height} /> : <Schematic points={points} height={height} />;
}

export const MapLegend = () => (
  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--text-2)" }}>
    {[["restaurant", t("Restaurant")], ["rider", t("Rider (live)")], ["riderStale", t("Rider (no update 5+ min)")], ["drop", t("Customer drop")]].map(([k, l]) => (
      <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: COLORS[k] }} />{l}
      </span>
    ))}
  </div>
);
