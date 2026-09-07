// src/components/NotificationBell.jsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getSocket, disconnectSocket } from "../services/socketService.js";
import { requestOrderFocus } from "../services/orderFocus.js";
import { playNotificationSound } from "../utils/notificationSound.js";
import { PRIMARY, BG_CARD, BORDER, TEXT_PRIMARY, TEXT_MUTED } from "../theme.js";

const EVENT_META = {
  "order:new":             { icon: "🔔", label: (p) => `New order ${p.order?.orderId || ""} — awaiting confirmation`, sound: true },
  "order:confirmed":       { icon: "✅", label: (p) => `Order ${p.order?.orderId || ""} confirmed` },
  "order:status_changed":  { icon: "🍳", label: (p) => `Order ${p.order?.orderId || ""} → ${p.order?.status || ""}` },
  "order:cancelled":       { icon: "❌", label: (p) => `Order ${p.order?.orderId || ""} cancelled` },
  "order:payment_changed": { icon: "💳", label: (p) => `Payment for ${p.order?.orderId || ""} → ${p.order?.paymentStatus || ""}` },
  "table:cleared":         { icon: "🧹", label: (p) => `Table ${p.session?.tableNo ?? ""} cleared` },
};

export default function NotificationBell({ user, onNavigate, inline = false }) {
  const [open, setOpen]     = useState(false);
  const [items, setItems]   = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const push = (event, payload) => {
      const meta = EVENT_META[event];
      if (!meta) return;
      const message = meta.label(payload || {});
      const order = payload?.order || null;

      setItems((prev) => [{
        id: `${Date.now()}-${Math.random()}`, icon: meta.icon, message, at: new Date(),
        order: order ? { _id: order._id, orderId: order.orderId } : null,
      }, ...prev].slice(0, 30));
      setUnread((n) => n + 1);

      if (meta.sound) playNotificationSound();
      toast(
        (t) => (
          <span
            onClick={() => { toast.dismiss(t.id); if (order) { onNavigate?.(); requestOrderFocus(order); } }}
            style={{ cursor: order ? "pointer" : "default" }}
          >
            {message}{order ? "  ›" : ""}
          </span>
        ),
        { icon: meta.icon, duration: 4000 },
      );
    };

    const handlers = {};
    for (const event of Object.keys(EVENT_META)) {
      handlers[event] = (payload) => push(event, payload);
      socket.on(event, handlers[event]);
    }

    return () => {
      for (const event of Object.keys(handlers)) socket.off(event, handlers[event]);
    };
  }, [user, onNavigate]);

  // Disconnect the socket entirely on logout.
  useEffect(() => {
    if (!user) disconnectSocket();
  }, [user]);

  if (!user) return null;

  // Inline (sidebar) variant sits in normal flow next to the theme toggle;
  // the dropdown itself still renders `position: fixed` — the sidebar's
  // `overflow-y: auto` would otherwise clip anything wider than its 228px
  // column, since setting one overflow axis forces the other off `visible`.
  const wrapperStyle = inline
    ? { position: "relative", display: "inline-flex" }
    : { position: "fixed", top: 18, right: 24, zIndex: 200 };
  const buttonStyle = inline
    ? {
        width: 34, height: 34, borderRadius: "var(--r-ctl)", border: "1px solid var(--edge)",
        background: "var(--card-2)", color: "var(--text-2)", fontSize: 15, cursor: "pointer",
        position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
      }
    : {
        width: 40, height: 40, borderRadius: "50%", border: `1px solid ${BORDER}`,
        background: BG_CARD, color: TEXT_PRIMARY, fontSize: 17, cursor: "pointer",
        position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      };
  const panelStyle = inline
    ? {
        position: "fixed", top: 68, left: 18, width: 300, maxHeight: 420, overflowY: "auto",
        background: "var(--grad-modal)", border: "1px solid var(--edge-hi)", borderRadius: 14,
        boxShadow: "var(--shadow-pop)", padding: 8, zIndex: 200,
      }
    : {
        position: "absolute", top: 48, right: 0, width: 320, maxHeight: 420, overflowY: "auto",
        background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 14,
        boxShadow: "0 20px 50px rgba(0,0,0,0.45)", padding: 8,
      };

  return (
    <div style={wrapperStyle}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) setUnread(0); }}
        style={buttonStyle}
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8,
            background: "#ef4444", color: "#fff", fontSize: 9.5, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={panelStyle}>
          <div style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <div style={{ padding: "26px 10px", textAlign: "center", fontSize: 12.5, color: TEXT_MUTED }}>
              Nothing yet — new orders will show up here.
            </div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.order) return;
                  setOpen(false);
                  onNavigate?.();
                  requestOrderFocus(n.order);
                }}
                style={{
                  display: "flex", gap: 10, padding: "9px 10px", borderRadius: 10,
                  cursor: n.order ? "pointer" : "default",
                }}
                onMouseEnter={(e) => { if (n.order) e.currentTarget.style.background = "rgba(127,127,127,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 15 }}>{n.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: TEXT_PRIMARY }}>
                    {n.message}{n.order ? "  ›" : ""}
                  </div>
                  <div style={{ fontSize: 10.5, color: TEXT_MUTED, marginTop: 2 }}>
                    {n.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
