// src/pages/admin/NotificationsPage.jsx
// Sends a push notification (title + description) right away to every
// customer who opted in via the customer app's Profile → Offer Notifications
// toggle; it also lands in each customer's Notifications list. Coupon
// announcements are sent from Admin → Coupons instead (scheduled for the
// coupon's start date — restaurant-server/services/couponOfferService.js);
// they show up in the history below alongside these.
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import PageHeader from "./shared/PageHeader.jsx";
import {
  sendOfferNotification, getNotificationHistory, cancelScheduledOffer,
} from "../../services/notificationService.js";
import { t, tn, N_, fmtNum, fmtDateTime } from "../../i18n/core.js";

// Server limits (services/notificationService.js → sendOfferBroadcast).
const TITLE_MAX = 80;
const DESC_MAX = 200;

const STATUS_TAG = {
  SCHEDULED: { cls: "vio",   label: N_("Scheduled") },
  SENDING:   { cls: "live",  label: N_("Sending") },
  SENT:      { cls: "ready", label: N_("Sent") },
  FAILED:    { cls: "stop",  label: N_("Failed") },
  CANCELLED: { cls: "done",  label: N_("Cancelled") },
};

const fmt = (d) => (d ? fmtDateTime(d, { dateStyle: "medium", timeStyle: "short" }) : "");

export default function NotificationsPage() {
  const [title, setTitle]     = useState("");
  const [description, setDescription] = useState("");
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

  // Scheduled coupon announcements flip to Sent on the server's 30s tick —
  // keep the list (and "expired" labels) current while this page is open.
  const hasPending = (history || []).some((n) => n.status === "SCHEDULED" || n.status === "SENDING");
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); if (hasPending) load(); }, 30 * 1000);
    return () => clearInterval(id);
  }, [hasPending, load]);

  const canSend = title.trim() && description.trim() && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    const who = tn(subscriberCount, "{n} customer", "{n} customers");
    if (!window.confirm(t("Send this notification to {who} now? This can't be undone.", { who }))) return;

    setSending(true);
    try {
      await sendOfferNotification({
        title: title.trim(), body: description.trim(), couponCode: "", startsAt: null, expiresAt: null,
      });
      toast.success(t("Notification sent"));
      setTitle(""); setDescription("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || t("Couldn't send notification"));
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async (n) => {
    if (!window.confirm(t("Cancel \"{title}\"? It won't be sent.", { title: n.title }))) return;
    try {
      await cancelScheduledOffer(n._id);
      toast.success(t("Scheduled notification cancelled"));
    } catch (err) {
      toast.error(err?.response?.data?.message || t("Couldn't cancel"));
    } finally {
      load();
    }
  };

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 };
  const countStyle = { fontSize: 11.5, marginTop: 5, color: "var(--text-3)", textAlign: "right" };

  return (
    <div>
      <PageHeader title={t("Notifications")} sub={t("Send a push notification to every customer who has turned on notifications in the customer app")} />

      <div className="zc-card" style={{ marginBottom: 20 }}>
        <div className="zc-card-h">
          <span className="t">{t("Send a notification")}</span>
          <span className="s">{tn(subscriberCount, "{n} customer subscribed", "{n} customers subscribed")}</span>
        </div>
        <div className="zc-card-b" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
          <div>
            <label htmlFor="notif-title" style={labelStyle}>{t("Notification title")}</label>
            <input
              id="notif-title"
              className="zc-input"
              placeholder={t("e.g. Weekend special!")}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div style={countStyle}>{fmtNum(title.length)}/{fmtNum(TITLE_MAX)}</div>
          </div>
          <div>
            <label htmlFor="notif-desc" style={labelStyle}>{t("Notification description")}</label>
            <textarea
              id="notif-desc"
              className="zc-textarea"
              placeholder={t("e.g. Live music tonight from 8 PM — see you there!")}
              value={description}
              maxLength={DESC_MAX}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div style={countStyle}>{fmtNum(description.length)}/{fmtNum(DESC_MAX)}</div>
          </div>

          {(title.trim() || description.trim()) && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", maxWidth: 420, background: "var(--card-2)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
                {t("Preview")}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title.trim() || t("Notification title")}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", whiteSpace: "pre-line" }}>
                {description.trim() || t("Notification description")}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
            {t("To announce a coupon, tick “Send a notification” when creating it in Coupons — it goes out on the coupon's start date.")}
          </div>

          <div>
            <button type="button" className="zc-btn pri" disabled={!canSend} onClick={handleSend}>
              {sending ? t("Sending…") : `📣 ${t("Send to all customers")}`}
            </button>
          </div>
        </div>
      </div>

      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">{t("Sent notifications")}</span>
          <span className="s">{t("Scheduled first, then the most recent")}</span>
        </div>
        <div className="zc-card-b" style={{ padding: 0 }}>
          {history === null ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>{t("Loading…")}</div>
          ) : history.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>{t("No notifications yet")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="zc-ledger" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>{t("Status")}</th>
                    <th>{t("Title")}</th>
                    <th>{t("Description")}</th>
                    <th style={{ width: 120 }}>{t("Coupon")}</th>
                    <th style={{ width: 170 }}>{t("When")}</th>
                    <th style={{ width: 150 }}>{t("Expires")}</th>
                    <th style={{ width: 90 }}>{t("Recipients")}</th>
                    <th style={{ width: 100 }}>{t("By")}</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((n) => {
                    const status = n.status || "SENT";
                    const tag = STATUS_TAG[status] || STATUS_TAG.SENT;
                    const expired = n.expiresAt && new Date(n.expiresAt).getTime() <= now;
                    const when = status === "SENT" ? fmt(n.sentAt || n.createdAt)
                      : status === "SCHEDULED" ? t("Sends {date}", { date: fmt(n.startsAt) })
                      : fmt(n.startsAt || n.createdAt);
                    return (
                      <tr key={n._id}>
                        <td>
                          <span className={`zc-tag ${tag.cls}`} title={n.error || undefined}><i />{t(tag.label)}</span>
                          {status === "FAILED" && n.error && (
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, maxWidth: 160, whiteSpace: "normal" }}>{n.error}</div>
                          )}
                        </td>
                        <td>{n.title}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</td>
                        <td style={{ fontWeight: 600, letterSpacing: ".04em" }}>{n.couponCode || "—"}</td>
                        <td>{when}</td>
                        <td style={{ color: expired ? "var(--text-3)" : undefined }}>
                          {n.expiresAt ? `${fmt(n.expiresAt)}${expired ? ` (${t("expired")})` : ""}` : "—"}
                        </td>
                        <td>{status === "SENT" ? fmtNum(n.recipientCount) : "—"}</td>
                        <td>{n.sentBy?.name || t("Admin")}</td>
                        <td>
                          {status === "SCHEDULED" && (
                            <button type="button" className="zc-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => handleCancel(n)}>
                              {t("Cancel")}
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
