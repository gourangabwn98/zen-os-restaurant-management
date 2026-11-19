// /track/:token — public live tracking for ONE delivery. No login and no app
// install. The signed token is the only authorisation (server-side checked,
// expiring, revocable). Shows only this order: its status, its destination
// pin and the rider's position — never a hand-over code or phone number.
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getTracking, watchTracking } from "../services/deliveryService.js";
import DeliveryTracker from "../components/delivery/DeliveryTracker.jsx";
import { Loader } from "../components/StateViews.jsx";

export default function TrackPage() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [riderLoc, setRiderLoc] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getTracking(token)
      .then(({ data }) => { if (alive) { setView(data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.message || "Couldn't load tracking — check your connection."); });
    load();
    const poll = setInterval(load, 30000); // safety net if the live connection drops
    const stop = watchTracking(token, {
      onStatus: (p) => { if (p?.jobId) setView((v) => (v && v.jobId === p.jobId ? { ...v, status: p.status, label: p.label } : v)); load(); },
      onLocation: (p) => { if (p?.location) setRiderLoc(p.location); },
    });
    return () => { alive = false; clearInterval(poll); stop(); };
  }, [token]);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px 40px" }}>
      <div className="page-h" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{view ? `Order #${view.orderNo}` : "Track your order"}</h2>
        {view?.restaurant?.name && <p className="small muted" style={{ margin: "2px 0 0" }}>from {view.restaurant.name}</p>}
      </div>
      {!view && !error && <Loader />}
      {error && !view && (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ margin: "6px 0 12px" }}>{error}</p>
          <Link to="/orders" className="btn btn-ghost btn-sm">My orders</Link>
        </div>
      )}
      {view && <DeliveryTracker view={view} riderLocation={riderLoc} />}
      {view && error && <p className="small muted center">Reconnecting… showing the last update.</p>}
    </div>
  );
}
