// src/pages/admin/NotificationsPage.jsx
// Broadcasts an "offer" push notification to every customer who opted in
// via the customer app's Profile → Offer Notifications toggle. Optional
// coupon code and offer window: with a future start time the offer is
// SCHEDULED and the server pushes it automatically at that time (see
// restaurant-server/services/notificationService.js → runDueOffers); with no
// start time it goes out now. The expiry marks the coupon expired for
// customers and stops late pushes.
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import PageHeader from "./shared/PageHeader.jsx";
import {
  sendOfferNotification, getNotificationHistory, cancelScheduledOffer,
} from "../../services/notificationService.js";

// Mirrors the server rule in services/notificationService.js (normalizeCouponCode).
const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;
// A start within the next minute is sent immediately (server: SEND_NOW_GRACE_MS).
const SEND_NOW_GRACE_MS = 60 * 1000;

const STATUS_TAG = {
  SCHEDULED: { cls: "vio",   label: "Scheduled" },
  SENDING:   { cls: "live",  label: "Sending" },
  SENT:      { cls: "ready", label: "Sent" },
  FAILED:    { cls: "stop",  label: "Failed" },
  CANCELLED: { cls: "done",  label: "Cancelled" },
};

const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** <input type="datetime-local"> value for a Date, in the browser's local time. */
const toLocalInput = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** datetime-local value → Date (read as the admin's local time), or null. */
const fromLocalInput = (v) => (v ? new Date(v) : null);

export default function NotificationsPage() {
  const [title, setTitle]     = useState("");
  const [body, setBody]       = useState("");
  const [coupon, setCoupon]   = useState("");
  const [startsAt, setStartsAt]   = useState(""); // datetime-local strings; "" = not set
  const [expiresAt, setExpiresAt] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(null);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    getNotificationHistory()
      .then(({ data }) => { setHistory(data.history || []); setSubscriberCount(data.subscriberCount || 0); })
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Scheduled offers flip to Sent on the server's 30s tick — keep the list
  // (and "starts in"/"expired" labels) current while this page is open.
  const hasPending = (history || []).some((n) => n.status === "SCHEDULED" || n.status === "SENDING");
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); if (hasPending) load(); }, 30 * 1000);
    return () => clearInterval(id);
  }, [hasPending, load]);

  const couponError = coupon && !COUPON_RE.test(coupon)
    ? "3–20 characters: letters, numbers, - or _"
    : "";

  const start = fromLocalInput(startsAt);
  const end = fromLocalInput(expiresAt);
  const isScheduled = !!start && start.getTime() > Date.now() + SEND_NOW_GRACE_MS;
  const timingError =
    end && end.getTime() <= Date.now() ? "Expiry must be in the future"
    : end && start && end.getTime() <= start.getTime() ? "Expiry must be after the start"
    : "";

  const canSend = title.trim() && body.trim() && !couponError && !timingError && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    const who = `${subscriberCount} customer${subscriberCount === 1 ? "" : "s"}`;
    const ask = isScheduled
      ? `Schedule this offer? It will be sent automatically on ${fmt(start)} to everyone subscribed then (currently ${who}). You can cancel it until then.`
      : `Send this notification to ${who} now? This can't be undone.`;
    if (!window.confirm(ask)) return;

    setSending(true);
    try {
      const { data } = await sendOfferNotification({
        title: title.trim(), body: body.trim(), couponCode: coupon,
        startsAt: isScheduled ? start.toISOString() : null,
        expiresAt: end ? end.toISOString() : null,
      });
      toast.success(data?.log?.status === "SCHEDULED" ? `Scheduled for ${fmt(data.log.startsAt)}` : "Notification sent");
      setTitle(""); setBody(""); setCoupon(""); setStartsAt(""); setExpiresAt("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't send notification");
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async (n) => {
    if (!window.confirm(`Cancel "${n.title}"? It won't be sent.`)) return;
    try {
      await cancelScheduledOffer(n._id);
      toast.success("Scheduled offer cancelled");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't cancel");
    } finally {
      load();
    }
  };

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 };
  const hintStyle = (bad) => ({ fontSize: 11.5, marginTop: 5, color: bad ? "var(--danger, #d33)" : "var(--text-3)" });
  const minLocal = toLocalInput(new Date(now));

  return (
    <div>
      <PageHeader title="Offers" sub="Send a push notification to every customer who has opted in — now, or automatically at a start time you pick" />

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
            <label htmlFor="offer-coupon" style={labelStyle}>
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
            <div id="offer-coupon-hint" style={hintStyle(!!couponError)}>
              {couponError || "Shown in the push notification and in each customer's notification history, with a copy button."}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", maxWidth: 260 }}>
              <label htmlFor="offer-start" style={labelStyle}>
                Starts <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span>
              </label>
              <input
                id="offer-start" type="datetime-local" className="zc-input"
                value={startsAt} min={minLocal}
                onChange={(e) => setStartsAt(e.target.value)}
              />
              <div style={hintStyle(false)}>
                {isScheduled ? "The notification is sent automatically at this time." : "Leave empty to send right away."}
              </div>
            </div>
            <div style={{ flex: "1 1 220px", maxWidth: 260 }}>
              <label htmlFor="offer-expiry" style={labelStyle}>
                Expires <span style={{ fontWeight: 400, color: "var(--text-3)" }}>(optional)</span>
              </label>
              <input
                id="offer-expiry" type="datetime-local" className="zc-input"
                value={expiresAt} min={startsAt || minLocal}
                aria-invalid={!!timingError}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <div style={hintStyle(!!timingError)}>
                {timingError || "After this, customers see the offer as expired."}
              </div>
            </div>
          </div>

          {(title.trim() || body.trim()) && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", maxWidth: 420, background: "var(--card-2)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
                Preview
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title.trim() || "Title"}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", whiteSpace: "pre-line" }}>
                {body.trim() || "Message"}
                {coupon && !couponError ? `\nUse code: ${coupon}` : ""}
                {end && !timingError ? `\nValid till ${fmt(end)}` : ""}
              </div>
            </div>
          )}

          <div>
            <button type="button" className="zc-btn pri" disabled={!canSend} onClick={handleSend}>
              {sending ? "Saving…" : isScheduled ? `🕒 Schedule for ${fmt(start)}` : "📣 Send to all customers"}
            </button>
          </div>
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">Offers</span>
          <span className="s">Scheduled first, then the most recent</span>
        </div>
        <div className="zc-card-b" style={{ padding: 0 }}>
          {history === null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No offers yet</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="zc-ledger" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Status</th>
                    <th>Title</th>
                    <th>Message</th>
                    <th style={{ width: 120 }}>Coupon</th>
                    <th style={{ width: 170 }}>When</th>
                    <th style={{ width: 150 }}>Expires</th>
                    <th style={{ width: 90 }}>Recipients</th>
                    <th style={{ width: 100 }}>By</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((n) => {
                    const status = n.status || "SENT";
                    const tag = STATUS_TAG[status] || STATUS_TAG.SENT;
                    const expired = n.expiresAt && new Date(n.expiresAt).getTime() <= now;
                    const when = status === "SENT" ? fmt(n.sentAt || n.createdAt)
                      : status === "SCHEDULED" ? `Sends ${fmt(n.startsAt)}`
                      : fmt(n.startsAt || n.createdAt);
                    return (
                      <tr key={n._id}>
                        <td>
                          <span className={`zc-tag ${tag.cls}`} title={n.error || undefined}><i />{tag.label}</span>
                          {status === "FAILED" && n.error && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, maxWidth: 160, whiteSpace: "normal" }}>{n.error}</div>
                          )}
                        </td>
                        <td>{n.title}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</td>
                        <td style={{ fontWeight: 600, letterSpacing: ".04em" }}>{n.couponCode || "—"}</td>
                        <td>{when}</td>
                        <td style={{ color: expired ? "var(--text-3)" : undefined }}>
                          {n.expiresAt ? `${fmt(n.expiresAt)}${expired ? " (expired)" : ""}` : "—"}
                        </td>
                        <td>{status === "SENT" ? n.recipientCount : "—"}</td>
                        <td>{n.sentBy?.name || "Admin"}</td>
                        <td>
                          {status === "SCHEDULED" && (
                            <button type="button" className="zc-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => handleCancel(n)}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
