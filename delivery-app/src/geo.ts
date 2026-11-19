// Distances, formatting, polyline decoding and the LOCAL stop suggestion used
// when the server can't compute a real route (no Google Routes key / offline).
// The local suggestion never invents an ETA — it only orders stops and shows
// straight-line distance, labelled as such.
export type LatLng = { latitude: number; longitude: number };

export const isPoint = (p: any): p is LatLng =>
  p != null && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));

export const meters = (a: LatLng, b: LatLng) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * r, dLng = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};

export const fmtKm = (m: number | null | undefined) => (m == null ? '—' : m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtMin = (sec: number | null | undefined) => (sec == null ? '' : sec < 90 ? '1 min' : `${Math.round(sec / 60)} min`);
export const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
export const rupees = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Google encoded polyline → coordinates (the format is bit-packed, hence the bitwise ops). */
/* eslint-disable no-bitwise */
export const decodePolyline = (str: string): LatLng[] => {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) {lat += d;} else {lng += d;}
    }
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
};

/* eslint-enable no-bitwise */

export type Stop = { kind: 'PICKUP' | 'DROP'; jobIds: string[]; point: LatLng; label: string; legDurationSec?: number | null; legDistanceM?: number | null };

/**
 * Local suggestion: (1) one restaurant stop for every order not picked up yet
 * (pickup dependency), (2) drops by nearest-next from there, but an order
 * accepted >25 min ago jumps ahead (food freshness). Advisory only.
 */
export const suggestStops = (jobs: any[], from: LatLng | null, restaurant: LatLng | null): Stop[] => {
  const stops: Stop[] = [];
  const needPickup = jobs.filter((j) => ['ASSIGNED', 'AT_RESTAURANT'].includes(j.status));
  const pickupPoint = isPoint(needPickup[0]?.pickup) ? needPickup[0].pickup : restaurant;
  if (needPickup.length && pickupPoint) {stops.push({ kind: 'PICKUP', jobIds: needPickup.map((j) => j.jobId), point: pickupPoint, label: needPickup[0]?.pickup?.name || 'Restaurant' });}
  let cursor = stops.length ? stops[0].point : from || restaurant;
  const left = jobs.filter((j) => isPoint(j.drop));
  const now = Date.now();
  while (left.length) {
    const urgent = left.filter((j) => j.assignedAt && now - new Date(j.assignedAt).getTime() > 25 * 60000);
    const pool = urgent.length ? urgent : left;
    pool.sort((a, b) => (cursor ? meters(cursor, a.drop) - meters(cursor, b.drop) : 0));
    const next = pool[0];
    left.splice(left.indexOf(next), 1);
    stops.push({ kind: 'DROP', jobIds: [next.jobId], point: next.drop, label: `#${next.orderNo}`, legDistanceM: cursor ? Math.round(meters(cursor, next.drop)) : null });
    cursor = next.drop;
  }
  return stops;
};
