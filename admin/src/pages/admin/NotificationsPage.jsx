// src/pages/admin/NotificationsPage.jsx
// Broadcasts an "offer" push notification to every customer who opted in
// via the customer app's Profile → Offer Notifications toggle. One-way —
// there's no per-customer targeting or scheduling, just "send it now to
// everyone subscribed" (see restaurant-server/services/notificationService.js).
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import PageHeader from "./shared/PageHeader.jsx";
import { sendOfferNotification, getNotificationHistory } from "../../services/notificationService.js";

// Mirrors the server rule in services/notificationService.js (normalizeCouponCode).
const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;

export default function NotificationsPage() {
  const [title, setTitle]     = useState("");
  const [body, setBody]       = useState("");
  const [coupon, setCoupon]   = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(null);
  const [subscriberCount, setSubscriberCount] = useState(0);

  const load = useCallback(() => {
    getNotificationHistory()
      .then(({ data }) => { setHistory(data.history || []); setSubscriberCount(data.subscriberCount || 0); })
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const couponError = coupon && !COUPON_RE.test(coupon)
    ? "3–20 characters: letters, numbers, - or _"
    : "";
  const canSend = title.trim() && body.trim() && !couponError && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    if (!window.confirm(`Send this notification to ${subscriberCount} customer${subscriberCount === 1 ? "" : "s"} now? This can't be undone.`)) return;

    setSending(true);
    try {
      await sendOfferNotification({ title: title.trim(), body: body.trim(), couponCode: coupon });
      toast.success("Notification sent");
      setTitle(""); setBody(""); setCoupon("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't send notification");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader title="Offers" sub="Send a push notification to every customer who has opted in — arrives even if their app is closed" />

      <div className="zc-card" style={{ marginBottom: 20 }}>
        <div className="zc-card-h">
          <span className="t">Send a notification</span>
          <span className="s">{subscriberCount} customer{subscriberCount === 1 ? "" : "s"} subscribed</span>
        </div>
        <div className="zc-card-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            className="zc-input"
            placeholder="Title — e.g. '20% off this weekend!'"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="zc-textarea"
            placeholder="Message — e.g. 'Show this at checkout for 20% off your order, Sat–Sun only.'"
            value={body}
            maxLength={200}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <label htmlFor="offer-coupon" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>
              Coupon code <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span>
            </label>
            <input
              id="offer-coupon"
              className="zc-input"
              placeholder="e.g. WEEKEND20"
              value={coupon}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              style={{ maxWidth: 260, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}
              aria-invalid={!!couponError}
              aria-describedby="offer-coupon-hint"
              onChange={(e) => setCoupon(e.target.value.toUpperCase().replace(/\s/g, ""))}
            />
            <div id="offer-coupon-hint" style={{ fontSize: 11.5, marginTop: 5, color: couponError ? "var(--danger, #d33)" : "var(--text-3)" }}>
              {couponError || "Shown in the push notification and in each customer's notification history, with a copy button."}
            </div>
          </div>

          {(title.trim() || body.trim()) && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", maxWidth: 420, background: "var(--card-2)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
                Preview
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title.trim() || "Title"}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", whiteSpace: "pre-line" }}>
                {body.trim() || "Message"}{coupon && !couponError ? `\nUse code: ${coupon}` : ""}
              </div>
            </div>
          )}

          <div>
            <button type="button" className="zc-btn pri" disabled={!canSend} onClick={handleSend}>
              {sending ? "Sending…" : "📣 Send to all customers"}
            </button>
          </div>
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">Sent history</span>
        </div>
        <div className="zc-card-b" style={{ padding: 0 }}>
          {history === null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No notifications sent yet</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="zc-ledger" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Message</th>
                    <th style={{ width: 120 }}>Coupon</th>
                    <th style={{ width: 90 }}>Recipients</th>
                    <th style={{ width: 130 }}>Sent</th>
                    <th style={{ width: 110 }}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((n) => (
                    <tr key={n._id}>
                      <td>{n.title}</td>
                      <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</td>
                      <td style={{ fontWeight: 600, letterSpacing: ".04em" }}>{n.couponCode || "—"}</td>
                      <td>{n.recipientCount}</td>
                      <td>{new Date(n.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td>{n.sentBy?.name || "Admin"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
