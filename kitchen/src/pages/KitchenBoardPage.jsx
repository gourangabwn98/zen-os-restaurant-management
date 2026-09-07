// src/pages/KitchenBoardPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Kitchen display" — migrated to the shared design system
// (design-reference/zen-os-design-reference.html → "Kitchen display" screen):
// dark violet ticket cards, a live clock, and tickets that turn red once
// they've run past a target time — instead of the previous flat navy board.
//
// All state/data logic is UNCHANGED from the previous build: same socket
// events (kot:created / order:status_changed / order:confirmed /
// order:cancelled), same backfill-on-reconnect, same duplicate-alert guard
// via seenJobIds, same PATCH /kitchen/orders/:id/status action calls. The
// "red" urgency tone is new — the reference's own description says "red
// means the ticket has run past its target time", and there's no such field
// on the order, so it's computed client-side from a real timestamp
// (createdAt) against a fixed threshold, combined with the real
// staff-set `priority: "URGENT"` flag that already existed.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { getSocket, disconnectSocket } from "../services/socketService.js";
import { getKitchenOrders, updateKitchenOrderStatus } from "../services/kitchenService.js";
import { useAppState } from "../context/AppState.jsx";
import {
  playNewOrderAlert, playUrgentOrderAlert, unlockAudio, isAudioUnlocked,
} from "../utils/kitchenAlertSound.js";
import {
  VOID, CARD_2, EDGE, EDGE_HI, VIOLET, LIVE, WAIT, READY_C, STOP,
  T1, T2, T3, GRAD_BTN, GRAD_CARD, GRAD_BG, R_CARD, R_CTL,
} from "../theme.js";

const SOUND_PREF_KEY = "kitchenSoundEnabled";
const loadSoundPref = () => {
  const raw = localStorage.getItem(SOUND_PREF_KEY);
  return raw === null ? true : raw === "true";
};

// No backend "target time" field exists per ticket — this is a fixed,
// documented heuristic: past this many minutes since the KOT was created,
// a still-pending ticket turns red so it can't be missed on a busy board.
const OVER_TARGET_MIN = 15;

const COLUMNS = [
  { status: "CONFIRMED", label: "New", dot: LIVE, action: null },
  { status: "PREPARING", label: "Preparing", dot: WAIT, action: { to: "READY", label: "✓ Mark ready" } },
  { status: "READY",     label: "Ready", dot: READY_C, action: null },
];

// live-updating clock + elapsed-time source, ticking once a second
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Tag({ tone, children }) {
  const c = { live: LIVE, wait: WAIT, ready: READY_C, stop: STOP }[tone] || T3;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600,
      padding: "4px 10px", borderRadius: 20, color: c,
      background: `${c}26`, border: `1px solid ${c}55`, whiteSpace: "nowrap",
    }}>
      <i style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 7px ${c}` }} />
      {children}
    </span>
  );
}

function KitchenTicket({ order, now, busy, onStartPreparing, onAdvance, action, column }) {
  const elapsedMin = Math.max(0, Math.floor((now - new Date(order.createdAt)) / 60000));
  const overTarget = elapsedMin >= OVER_TARGET_MIN;
  const urgent = order.priority === "URGENT";

  let tone, value, label;
  if (column === "READY") {
    tone = "ready"; value = "—"; label = "ready";
  } else if (urgent || overTarget) {
    tone = "stop"; value = `${elapsedMin}m`; label = urgent ? "URGENT" : "over target";
  } else if (column === "PREPARING") {
    tone = "wait"; value = `${elapsedMin}m`; label = "cooking";
  } else {
    tone = "live"; value = `${elapsedMin}m`; label = "waiting";
  }
  const toneColor = { live: LIVE, wait: WAIT, ready: READY_C, stop: STOP }[tone];
  const borderColor = tone === "stop" ? `${STOP}8C` : tone === "wait" ? `${WAIT}66` : EDGE_HI;

  return (
    <div style={{
      borderRadius: R_CARD, overflow: "hidden", position: "relative",
      background: GRAD_CARD, border: `1px solid ${borderColor}`,
      boxShadow: tone === "stop" ? `0 16px 38px -20px rgba(0,0,0,.9), 0 0 26px -10px ${STOP}99` : "0 16px 38px -20px rgba(0,0,0,.9)",
    }}>
      <div style={{
        padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "linear-gradient(140deg, rgba(255,255,255,.07), rgba(255,255,255,.01))", borderBottom: `1px solid ${EDGE}`,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: T1 }}>
            {order.tableNo ? `Table ${order.tableNo}` : "Takeaway"}
          </div>
          <div style={{ fontSize: 10.5, color: T3 }}>{order.orderId}{order.waiterName ? ` · ${order.waiterName}` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.03em", color: toneColor }}>{value}</div>
          <div style={{ fontSize: 9.5, color: T3, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
        </div>
      </div>

      <div style={{ padding: "11px 14px" }}>
        {order.items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13.5, alignItems: "flex-start" }}>
            <span style={{
              minWidth: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center",
              fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.09)", color: "#fff", flex: "none",
            }}>{it.qty}</span>
            <span style={{ flex: 1, fontWeight: 500, lineHeight: 1.35, color: T1 }}>
              {it.name}
              {it.notes && <em style={{ display: "block", fontStyle: "normal", fontSize: 11, color: WAIT, fontWeight: 600 }}>{it.notes}</em>}
            </span>
          </div>
        ))}
        {order.notes && (
          <div style={{ marginTop: 8, padding: "8px 10px", background: `${WAIT}1A`, borderRadius: 8, fontSize: 12, color: WAIT, fontWeight: 600 }}>
            Note: {order.notes}
          </div>
        )}

        {column === "CONFIRMED" && (
          <button disabled={busy} onClick={onStartPreparing} style={ticketBtn(WAIT)}>
            {busy ? "…" : "▶ Start preparing"}
          </button>
        )}
        {action && column === "PREPARING" && (
          <button disabled={busy} onClick={() => onAdvance(action.to)} style={ticketBtn(READY_C)}>
            {busy ? "…" : action.label}
          </button>
        )}
        {column === "READY" && (
          <div style={{ marginTop: 12, textAlign: "center", fontSize: 11.5, color: T3, fontStyle: "italic" }}>
            Waiting for waiter to deliver
          </div>
        )}
      </div>
    </div>
  );
}
const ticketBtn = (color) => ({
  marginTop: 12, width: "100%", padding: 12, borderRadius: R_CTL, border: "none",
  background: color, color: "#111", fontWeight: 800, fontSize: 13.5, cursor: "pointer", minHeight: 44,
});

export default function KitchenBoardPage() {
  const nav = useNavigate();
  const { auth } = useAppState();
  const [orders, setOrders]   = useState([]);
  const [soundOn, setSoundOn] = useState(loadSoundPref);
  const [needsUnlock, setNeedsUnlock] = useState(!isAudioUnlocked());
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const seenJobIds = useRef(new Set());
  const now = useNow();

  const upsertOrderSilently = useCallback((order) => {
    const key = order._id || order.orderId;
    seenJobIds.current.add(key);
    setOrders((prev) => {
      const exists = prev.some((o) => (o._id || o.orderId) === key);
      if (exists) return prev.map((o) => ((o._id || o.orderId) === key ? { ...o, ...order } : o));
      return [...prev, order];
    });
  }, []);

  const removeOrder = useCallback((key) => {
    setOrders((prev) => prev.filter((o) => (o._id || o.orderId) !== key));
  }, []);

  const backfill = useCallback(async () => {
    try {
      const { data } = await getKitchenOrders();
      setOrders(data.orders || []);
      (data.orders || []).forEach((o) => seenJobIds.current.add(o._id));
    } catch {
      /* transient — live socket feed still works; next reconnect retries */
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) { nav("/login", { replace: true }); return; }

    const onConnect = () => { setConnected(true); backfill(); };
    const onDisconnect = () => setConnected(false);

    const onKotCreated = (payload) => {
      const kotJob = payload?.kotJob || payload;
      if (!kotJob?._id) return;
      const key = kotJob.order || kotJob._id;
      if (seenJobIds.current.has(String(key))) return; // duplicate delivery — never re-alert
      seenJobIds.current.add(String(key));

      backfill(); // pull the authoritative, chef-safe ticket for display

      if (loadSoundPref()) {
        const played = kotJob.priority === "URGENT" ? playUrgentOrderAlert() : playNewOrderAlert();
        if (!played) setNeedsUnlock(true);
      }
      toast(`🔔 New order ${kotJob.orderId || ""}`, { duration: 3000 });
    };

    const onStatusChanged = (payload) => {
      const order = payload?.order;
      if (!order) return;
      if (["DELIVERED","COMPLETED","CANCELLED"].includes(order.status)) {
        removeOrder(order._id);
      } else {
        upsertOrderSilently(order);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("kot:created", onKotCreated);
    socket.on("order:status_changed", onStatusChanged);
    socket.on("order:confirmed", onStatusChanged);
    socket.on("order:cancelled", (p) => p?.order && removeOrder(p.order._id));
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("kot:created", onKotCreated);
      socket.off("order:status_changed", onStatusChanged);
      socket.off("order:confirmed", onStatusChanged);
      socket.off("order:cancelled");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_PREF_KEY, String(next));
  };

  const handleEnableSound = async () => {
    const unlocked = await unlockAudio();
    setNeedsUnlock(!unlocked);
    if (unlocked) playNewOrderAlert();
  };

  const handleStartPreparing = async (order) => {
    setBusyId(order._id);
    try {
      await updateKitchenOrderStatus(order._id, "PREPARING");
      upsertOrderSilently({ ...order, status: "PREPARING" });
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update");
    } finally { setBusyId(null); }
  };

  const handleAdvance = async (order, toStatus) => {
    setBusyId(order._id);
    try {
      await updateKitchenOrderStatus(order._id, toStatus);
      if (toStatus === "READY") upsertOrderSilently({ ...order, status: "READY" });
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't update");
    } finally { setBusyId(null); }
  };

  const handleLogout = () => {
    disconnectSocket();
    auth.logout();
    nav("/login", { replace: true });
  };

  const clockStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/^0/, "");

  return (
    <div style={{ minHeight: "100vh", background: GRAD_BG, color: T1, fontFamily: "'DM Sans', sans-serif" }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 14, padding: "14px 24px",
        borderBottom: `1px solid ${EDGE}`, position: "sticky", top: 0, background: VOID, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flex: "none",
            fontWeight: 800, fontSize: 13, color: "#fff", background: GRAD_BTN,
            boxShadow: `0 6px 18px -4px ${VIOLET}B3, inset 0 1px 0 rgba(255,255,255,.28)`,
          }}>🍳</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.02em" }}>Kitchen</div>
            <div style={{ fontSize: 11, color: T3, marginTop: -2 }}>Ad's Cafe</div>
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <Tag tone={connected ? "ready" : "stop"}>{connected ? "Connected" : "Reconnecting…"}</Tag>
        <span style={{ fontSize: 12.5, color: T2 }}>{auth.user?.name}{auth.user?.name ? " · " : ""}{auth.user?.role || "chef"}</span>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{clockStr}</div>

        <Link to="/profile" style={headerBtn}>👤 Profile</Link>
        <button onClick={toggleSound} style={{ ...headerBtn, background: soundOn ? `${READY_C}26` : CARD_2, color: soundOn ? READY_C : T2, borderColor: soundOn ? `${READY_C}55` : EDGE }}>
          {soundOn ? "🔊 Sound on" : "🔇 Sound off"}
        </button>
        <button onClick={handleLogout} style={{ ...headerBtn, color: STOP, borderColor: `${STOP}55` }}>Sign out</button>
      </header>

      {needsUnlock && (
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: "10px 20px",
          background: `${WAIT}26`, color: WAIT, fontSize: 13.5, fontWeight: 600, borderBottom: `1px solid ${WAIT}44`,
        }}>
          <span>Tap to enable kitchen alert sounds on this device</span>
          <button onClick={handleEnableSound} style={{ padding: "9px 16px", borderRadius: R_CTL, border: "none", background: WAIT, color: "#111", fontWeight: 800, cursor: "pointer" }}>
            Enable kitchen sound
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, padding: "20px 24px", alignItems: "start" }}>
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.status === col.status)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          return (
            <div key={col.status}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.dot, boxShadow: `0 0 10px ${col.dot}` }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>{col.label}</span>
                <span style={{ fontSize: 12, color: T3 }}>
                  {colOrders.length} ticket{colOrders.length === 1 ? "" : "s"}{col.status === "READY" && colOrders.length > 0 ? " · waiter alerted" : ""}
                </span>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {colOrders.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 10px", color: T3, fontSize: 13, border: `1px dashed ${EDGE}`, borderRadius: R_CARD }}>
                    No tickets
                  </div>
                )}
                {colOrders.map((o) => (
                  <KitchenTicket
                    key={o._id} order={o} now={now} column={col.status}
                    busy={busyId === o._id} action={col.action}
                    onStartPreparing={() => handleStartPreparing(o)}
                    onAdvance={(to) => handleAdvance(o, to)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const headerBtn = {
  padding: "9px 14px", borderRadius: R_CTL, border: `1px solid ${EDGE}`, background: CARD_2,
  color: T2, fontWeight: 700, fontSize: 12.5, cursor: "pointer", minHeight: 40,
  textDecoration: "none", display: "inline-flex", alignItems: "center", fontFamily: "inherit",
};
