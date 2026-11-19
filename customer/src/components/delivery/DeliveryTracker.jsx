// One delivery's live view: status steps, map + ETA, rider. `view` comes from
// GET /api/delivery/track/:token (public) or /api/delivery/orders/:id (owner —
// adds `otp`, `rider.phone`, `payment`). Only the owner variant ever has the
// hand-over code; the public page never receives it.
import { useCallback, useState } from "react";
import TrackingMap from "./TrackingMap.jsx";

const STEPS = [
  ["ASSIGNED", "Partner assigned"],
  ["AT_RESTAURANT", "At the restaurant"],
  ["PICKED_UP", "On the way"],
  ["AT_CUSTOMER", "Arrived"],
  ["DELIVERED", "Delivered"],
];
const order = STEPS.map(([s]) => s);

export const toLatLng = (p) => (p && p.latitude != null && p.longitude != null ? { lat: p.latitude, lng: p.longitude } : null);

export default function DeliveryTracker({ view, riderLocation, owner = false }) {
  const [eta, setEta] = useState(null);
  const onEta = useCallback((e) => setEta(e), []);
  const st = view.status;
  const idx = order.indexOf(st);
  const riderPos = toLatLng(riderLocation || view.rider?.location);
  const moving = ["ASSIGNED", "AT_RESTAURANT", "PICKED_UP", "AT_CUSTOMER"].includes(st);
  const amount = view.payment?.amountToPay;

  return (
    <>
      <div className={`live-card${["FAILED", "CANCELLED"].includes(st) ? " bad" : ""}`}>
        <div className="live-head">
          {moving && <span className="pulse" />}
          <b>{view.label}</b>
        </div>
        {st === "SEARCHING" && <p className="small muted" style={{ margin: "6px 0 0" }}>The restaurant is finding a delivery partner for your order.</p>}
        {st === "PICKED_UP" && eta?.text && <p style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 800 }}>Arriving in about {eta.text}</p>}
        {st === "PICKED_UP" && !eta && riderPos && view.approxDistanceMeters != null && (
          <p className="small" style={{ margin: "6px 0 0" }}>Rider is about {(view.approxDistanceMeters / 1000).toFixed(1)} km away (straight line)</p>
        )}
        {!["SEARCHING", "FAILED", "CANCELLED"].includes(st) && (
          <ol style={{ display: "flex", gap: 4, listStyle: "none", padding: 0, margin: "12px 0 0" }} aria-label="Delivery progress">
            {STEPS.map(([s, label], i) => (
              <li key={s} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 5, borderRadius: 9, background: i <= idx ? "var(--brand)" : "var(--line)" }} />
                <span className="small" style={{ fontSize: 10.5, fontWeight: i === idx ? 800 : 500, color: i <= idx ? "var(--text)" : "var(--muted, #999)" }}>{label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {owner && view.otp && (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="small muted">Share this code with your delivery partner at the door</div>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 10, margin: "4px 0" }} aria-label={`Hand-over code ${view.otp.split("").join(" ")}`}>{view.otp}</div>
          <div className="small muted">Only give it when you have your order.</div>
        </div>
      )}
      {owner && amount > 0 && (
        <div className="card notice" role="status">💵 <b>Cash on Delivery:</b> please keep ₹{amount} ready for the delivery partner.</div>
      )}

      {(moving || st === "DELIVERED") && toLatLng(view.destination) && (
        <div className="card" style={{ padding: 8 }}>
          <TrackingMap restaurant={toLatLng(view.restaurant)} drop={toLatLng(view.destination)} rider={moving ? riderPos : null} onEta={onEta} />
          {moving && !riderPos && <p className="small muted" style={{ margin: "8px 6px 2px" }}>The rider's live location appears once they start moving.</p>}
          {riderPos && riderLocation?.at && <p className="small muted" style={{ margin: "8px 6px 2px" }}>Updated {new Date(riderLocation.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
      )}

      {view.rider && moving && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30 }} aria-hidden="true">🛵</span>
          <span style={{ flex: 1 }}><b>{view.rider.name || "Your delivery partner"}</b><span className="small muted" style={{ display: "block" }}>Delivery partner</span></span>
          {owner && view.rider.phone
            ? <a className="btn btn-ghost btn-sm" href={`tel:${view.rider.phone}`}>📞 Call</a>
            : view.restaurant?.phone ? <a className="btn btn-ghost btn-sm" href={`tel:${view.restaurant.phone}`}>📞 Restaurant</a> : null}
        </div>
      )}
    </>
  );
}
