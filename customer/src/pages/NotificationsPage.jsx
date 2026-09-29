import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAppState } from "../context/AppState.jsx";
import { getMyNotifications, markNotificationsSeen, NOTIFICATIONS_CHANGED } from "../services/notificationService.js";
import { Loader, EmptyState, ErrorState } from "../components/StateViews.jsx";

/** Profile → Notifications: every offer the restaurant has broadcast, newest
 * first, with its coupon code (tap to copy). Opening the list marks it read. */
export default function NotificationsPage() {
  const { auth } = useAppState();
  const [data, setData]   = useState(null); // { notifications, seenAt, serverNow }
  const [error, setError] = useState(false);
  // "Read up to" as it was when this visit began — marking the list read
  // (and later reloads) must not wipe the NEW highlights mid-visit.
  const visitSeenAt = useRef(undefined);

  const load = useCallback(() => {
    setError(false);
    getMyNotifications()
      .then(({ data }) => {
        if (visitSeenAt.current === undefined) visitSeenAt.current = data.seenAt || null;
        // Judge expiry by the server's clock — a phone's clock can be wrong.
        setData({ ...data, clockSkew: data.serverNow ? new Date(data.serverNow).getTime() - Date.now() : 0 });
        // Keep the "new" highlight for this visit, but clear the badge.
        if (data.unreadCount > 0) markNotificationsSeen().catch(() => {});
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (!auth.isLoggedIn) return;
    load();
    // A new offer arriving while this page is open shows up immediately.
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, load);
  }, [auth.isLoggedIn, load]);

  return (
    <>
      <div className="page-h">
        <h2>Notifications</h2>
        <p>Offers and coupon codes from the restaurant.</p>
      </div>
      {!auth.isLoggedIn ? (
        <EmptyState icon="🔔" title="Log in to see your notifications"
          action={<Link to="/login" className="btn btn-primary" style={{ marginTop: 14 }}>Log In</Link>} />
      ) : error ? (
        <ErrorState message="Couldn't load notifications" onRetry={load} />
      ) : !data ? (
        <Loader label="Loading notifications…" />
      ) : data.notifications.length === 0 ? (
        <EmptyState icon="🔔" title="No notifications yet" sub="Offers from the restaurant will show up here." />
      ) : (
        data.notifications.map((n) => (
          <NotificationCard
            key={n._id} n={n}
            isNew={!visitSeenAt.current || new Date(n.sentAt) > new Date(visitSeenAt.current)}
            expired={!!n.expiresAt && new Date(n.expiresAt).getTime() <= Date.now() + data.clockSkew}
          />
        ))
      )}
    </>
  );
}

const fmt = (d) => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function NotificationCard({ n, isNew, expired }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(n.couponCode);
      toast.success(`Copied ${n.couponCode}`);
    } catch {
      toast(`Your code: ${n.couponCode}`, { icon: "🏷️" });
    }
  };

  return (
    <div className="card" style={{
      ...(isNew && !expired ? { boxShadow: "inset 3px 0 0 var(--brand), var(--sh-1)" } : null),
      ...(expired ? { opacity: 0.7 } : null),
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <b style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{n.title}</b>
        {expired
          ? <span className="small" style={{ color: "var(--text-3)", fontWeight: 800 }}>EXPIRED</span>
          : isNew && <span className="small" style={{ color: "var(--brand)", fontWeight: 800 }}>NEW</span>}
      </div>
      <p className="small" style={{ margin: "6px 0 0", lineHeight: 1.5, color: "var(--text-2)", whiteSpace: "pre-line" }}>{n.body}</p>
      {n.couponCode && expired && (
        <div style={{
          marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          borderRadius: 12, border: "1.5px dashed var(--line)", color: "var(--text-3)",
        }}>
          <span aria-hidden="true">🏷️</span>
          <s style={{ fontWeight: 800, letterSpacing: ".06em" }}>{n.couponCode}</s>
          <span className="small" style={{ marginLeft: "auto" }}>Expired</span>
        </div>
      )}
      {n.couponCode && !expired && (
        <button type="button" onClick={copy} aria-label={`Copy coupon code ${n.couponCode}`}
          style={{
            marginTop: 12, display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "10px 12px", borderRadius: 12, border: "1.5px dashed var(--brand)",
            background: "var(--brand-tint)", color: "var(--text)", font: "inherit", cursor: "pointer",
          }}>
          <span aria-hidden="true">🏷️</span>
          <span style={{ fontWeight: 800, letterSpacing: ".06em" }}>{n.couponCode}</span>
          <span className="small" style={{ marginLeft: "auto", color: "var(--brand)", fontWeight: 700 }}>Copy</span>
        </button>
      )}
      <div className="muted tiny" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
        <span>{fmt(n.sentAt)}</span>
        {n.expiresAt && <span>{expired ? "Expired" : "Valid till"} {fmt(n.expiresAt)}</span>}
      </div>
    </div>
  );
}
