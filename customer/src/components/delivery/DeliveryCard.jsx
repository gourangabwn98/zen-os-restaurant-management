// On the customer's own order page (home delivery only): the owner's view —
// hand-over code, rider + call, COD amount, live map — and the shareable
// tracking link. Live via the order room (the server mirrors delivery events
// there), re-read on each status change, polled as a safety net.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getMyDelivery, trackingUrl } from "../../services/deliveryService.js";
import { getSocket } from "../../services/socketService.js";
import DeliveryTracker from "./DeliveryTracker.jsx";

export default function DeliveryCard({ order }) {
  const [view, setView] = useState(null);
  const [riderLoc, setRiderLoc] = useState(null);
  const id = order._id;

  const load = useCallback(() => {
    getMyDelivery(id).then(({ data }) => setView(data)).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30000);
    const s = getSocket();
    const onStatus = (p) => { if (String(p?.orderId) === String(id)) load(); };
    const onLoc = (p) => { if (p?.location && view?.jobId && p.jobId === view.jobId) setRiderLoc(p.location); };
    s.on("delivery:status_updated", onStatus);
    s.on("delivery:location_updated", onLoc);
    return () => { clearInterval(poll); s.off("delivery:status_updated", onStatus); s.off("delivery:location_updated", onLoc); };
  }, [id, load, view?.jobId]);

  // Order status moved (e.g. ready / delivered) → refresh the delivery too.
  useEffect(() => { load(); }, [order.status, load]);

  if (!view) return null;
  if (!view.jobId) {
    return <div className="card"><div className="card-title">Home delivery</div><p className="small muted" style={{ margin: 0 }}>{view.label}</p></div>;
  }

  const share = async () => {
    if (!view.trackingToken) return;
    const url = trackingUrl(view.trackingToken);
    try {
      if (navigator.share) await navigator.share({ title: `Order #${view.orderNo}`, url });
      else { await navigator.clipboard.writeText(url); toast.success("Tracking link copied"); }
    } catch { /* cancelled */ }
  };

  return (
    <div>
      <DeliveryTracker view={view} riderLocation={riderLoc} owner />
      {view.trackingToken && !["DELIVERED", "FAILED", "CANCELLED"].includes(view.status) && (
        <button type="button" className="btn btn-ghost" onClick={share} style={{ marginBottom: 12 }}>🔗 Share live tracking link</button>
      )}
    </div>
  );
}
