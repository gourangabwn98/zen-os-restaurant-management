// Live delivery map for ONE order: restaurant, this customer's drop point and
// the rider. With a Google key: real map + the driving route from the rider
// to the customer and its ETA (Directions service). The route is asked again
// only when the rider has moved ~250 m or a minute passed — not on every GPS
// ping. Without a key, or if Google can't answer: a simple to-scale view and
// straight-line distance — an ETA is never invented.
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, hasMapsKey } from "../../utils/googleMaps.js";

const metres = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};
const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

function Simple({ restaurant, drop, rider }) {
  const pts = [restaurant, drop, rider].filter(ok);
  if (!ok(drop)) return null;
  const kx = 111320 * Math.cos((drop.lat * Math.PI) / 180), ky = 110540;
  const xy = (p) => ({ x: (p.lng - drop.lng) * kx, y: -(p.lat - drop.lat) * ky });
  const span = Math.max(400, ...pts.map((p) => { const q = xy(p); return Math.max(Math.abs(q.x), Math.abs(q.y)); })) * 1.25;
  const dot = (p, color, label, r) => { if (!ok(p)) return null; const q = xy(p); return (
    <g><circle cx={q.x} cy={q.y} r={span / r} fill={color} stroke="#fff" strokeWidth={span / 120} /><text x={q.x + span / 14} y={q.y + span / 50} fontSize={span / 11} fill="currentColor">{label}</text></g>
  ); };
  return (
    <svg viewBox={`${-span} ${-span} ${span * 2} ${span * 2}`} style={{ width: "100%", height: 260, background: "var(--bg)", borderRadius: 16 }} role="img" aria-label="Delivery positions">
      {ok(rider) && <line x1={xy(rider).x} y1={xy(rider).y} x2={0} y2={0} stroke="var(--brand)" strokeDasharray={span / 30} strokeWidth={span / 150} />}
      {dot(restaurant, "#7c5cff", "Restaurant", 16)}
      {dot(drop, "#e1460e", "You", 14)}
      {dot(rider, "#1f9d55", "Rider", 13)}
    </svg>
  );
}

export default function TrackingMap({ restaurant, drop, rider, onEta }) {
  const box = useRef(null);
  const map = useRef(null);
  const marks = useRef({});
  const routeLine = useRef(null);
  const lastRoute = useRef(null);
  const [useSimple, setUseSimple] = useState(!hasMapsKey());

  useEffect(() => {
    if (!hasMapsKey()) return undefined;
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive) return;
      if (!g || !box.current) { setUseSimple(true); return; }
      map.current = new g.Map(box.current, { center: drop, zoom: 14, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy" });
      routeLine.current = new g.Polyline({ map: map.current, strokeColor: "#E1460E", strokeWeight: 5, strokeOpacity: 0.85 });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers + bounds whenever positions change.
  useEffect(() => {
    const g = window.google?.maps;
    if (!g || !map.current) return;
    const put = (key, p, label) => {
      if (!ok(p)) { marks.current[key]?.setMap(null); delete marks.current[key]; return; }
      if (!marks.current[key]) marks.current[key] = new g.Marker({ map: map.current, label: { text: label, fontSize: "18px" } });
      marks.current[key].setPosition(p);
    };
    put("restaurant", restaurant, "🍽");
    put("drop", drop, "🏠");
    put("rider", rider, "🛵");
    const b = new g.LatLngBounds();
    [restaurant, drop, rider].filter(ok).forEach((p) => b.extend(p));
    if (!b.isEmpty()) map.current.fitBounds(b, 56);
  }, [restaurant, drop, rider]);

  // Route + ETA, rate-limited. No rider position → no route and no ETA.
  useEffect(() => {
    const g = window.google?.maps;
    if (!g || !map.current || !ok(rider) || !ok(drop)) { if (!ok(rider)) onEta?.(null); return; }
    const last = lastRoute.current;
    if (last && metres(last.from, rider) < 250 && Date.now() - last.at < 60000) return;
    lastRoute.current = { from: rider, at: Date.now() };
    new g.DirectionsService().route({ origin: rider, destination: drop, travelMode: g.TravelMode.DRIVING }, (res, status) => {
      if (status !== "OK" || !res?.routes?.[0]) { routeLine.current?.setPath([]); onEta?.(null); return; }
      routeLine.current?.setPath(res.routes[0].overview_path);
      const leg = res.routes[0].legs[0];
      onEta?.({ seconds: leg.duration?.value ?? null, meters: leg.distance?.value ?? null, text: leg.duration?.text || "" });
    });
  }, [rider, drop, onEta]);

  if (useSimple) return <Simple restaurant={restaurant} drop={drop} rider={rider} />;
  return <div ref={box} style={{ width: "100%", height: 300, borderRadius: 16 }} />;
}

export { metres };
