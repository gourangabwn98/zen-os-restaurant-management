// Live map — the restaurant, every online / busy rider (position from the
// delivery:location_updated socket feed, else the last stored fix) and the
// drop point of each active delivery. Admin + manager only (delivery-admin room).
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDeliveryLive } from "../../../services/deliveryAdminService.js";
import { EmptyState, Loader } from "../shared";
import { t } from "../../../i18n/core.js";
import DeliveryMap, { MapLegend } from "./DeliveryMap.jsx";
import { JOB_STATUS, ago } from "./shared.js";
import Tag from "./DeliveryTag.jsx";

const STALE_MS = 5 * 60 * 1000;

export default function LiveTab({ rev, live }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    getDeliveryLive().then((r) => { setData(r.data); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load, rev]);
  // Last-seen labels and "stale" age even without new events.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const riders = useMemo(() => (data?.partners || []).map((p) => {
    const loc = live[p.id] || p.lastLocation;
    return { ...p, loc, stale: !loc || now - new Date(loc.at) > STALE_MS };
  }), [data, live, now]);

  const points = useMemo(() => {
    if (!data) return [];
    const pts = [];
    if (data.restaurant?.latitude != null) pts.push({ id: "r", kind: "restaurant", lat: data.restaurant.latitude, lng: data.restaurant.longitude, label: data.restaurant.name || t("Restaurant") });
    for (const r of riders) {
      if (r.loc) pts.push({ id: `p${r.id}`, kind: "rider", stale: r.stale, lat: r.loc.latitude, lng: r.loc.longitude, label: r.name });
      for (const j of r.jobs) if (j.drop?.latitude != null) pts.push({ id: `d${j.jobId}`, kind: "drop", lat: j.drop.latitude, lng: j.drop.longitude, label: j.orderNo });
    }
    return pts;
  }, [data, riders]);

  if (error) return <div className="zc-card"><EmptyState title={t("Couldn't load the live map")} action={<button type="button" className="zc-btn" onClick={load}>{t("Retry")}</button>} /></div>;
  if (!data) return <div className="zc-card" style={{ padding: 20 }}><Loader rows={5} /></div>;

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
      <div className="zc-card" style={{ gridColumn: "span 2", minWidth: 0 }}>
        <div className="zc-card-h"><div><div className="t">{t("Live map")}</div><div className="s">{t("Riders send their position only while they have an active delivery")}</div></div></div>
        <div className="zc-card-b" style={{ display: "grid", gap: 10 }}>
          {data.restaurant?.latitude == null && <div className="zc-tag wait">{t("Set the restaurant's location in Profile so distances and the map are correct.")}</div>}
          <DeliveryMap points={points} />
          <MapLegend />
        </div>
      </div>
      <div className="zc-card">
        <div className="zc-card-h"><div><div className="t">{t("Riders")}</div><div className="s">{t("Online or carrying orders")}</div></div></div>
        <div className="zc-card-b">
          {!riders.length && <EmptyState title={t("No riders online")} />}
          {riders.map((r) => (
            <div key={r.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--edge)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>{r.name}</b><span style={{ fontSize: 12, color: r.stale ? "var(--wait-ink)" : "var(--text-3)" }}>{r.loc ? t("GPS {when}", { when: ago(r.loc.at) }) : t("no GPS yet")}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t("{a} of {c} active", { a: r.activeCount, c: r.capacity })}{r.phone ? ` · ${r.phone}` : ""}</div>
              {r.jobs.map((j) => <div key={j.jobId} style={{ fontSize: 12, marginTop: 4 }}>{j.orderNo} <Tag map={JOB_STATUS} value={j.status} /> <span style={{ color: "var(--text-3)" }}>{j.drop?.address}</span></div>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
