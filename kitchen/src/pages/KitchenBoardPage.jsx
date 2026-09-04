// src/pages/KitchenBoardPage.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { getSocket, disconnectSocket } from "../services/socketService.js";
import { getKitchenOrders, updateKitchenOrderStatus } from "../services/kitchenService.js";
import { useAppState } from "../context/AppState.jsx";
import {
  playNewOrderAlert, playUrgentOrderAlert, unlockAudio, isAudioUnlocked,
} from "../utils/kitchenAlertSound.js";
import { BG, CARD, BORDER, TEXT, TEXT_MUTED, BLUE, AMBER, GREEN, RED } from "../theme.js";

const SOUND_PREF_KEY = "kitchenSoundEnabled";
const loadSoundPref = () => {
  const raw = localStorage.getItem(SOUND_PREF_KEY);
  return raw === null ? true : raw === "true";
};

const COLUMNS = [
  { status: "CONFIRMED", label: "NEW",       color: BLUE,  action: null },
  { status: "PREPARING", label: "PREPARING", color: AMBER, action: { to: "READY", label: "✓ Mark Ready" } },
  { status: "READY",     label: "READY",     color: GREEN, action: null },
];

export default function KitchenBoardPage() {
  const nav = useNavigate();
  const { auth } = useAppState();
  const [orders, setOrders]   = useState([]);
  const [soundOn, setSoundOn] = useState(loadSoundPref);
  const [needsUnlock, setNeedsUnlock] = useState(!isAudioUnlocked());
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const seenJobIds = useRef(new Set());

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

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>🍳 Kitchen Board</span>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: connected ? GREEN : RED }} />
          <span style={{ fontSize: 12.5, color: TEXT_MUTED }}>{connected ? "Live" : "Reconnecting…"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: TEXT_MUTED }}>{auth.user?.name}</span>
          <Link to="/profile" style={{ ...styles.logoutBtn, textDecoration: "none", display: "inline-block" }}>👤 Profile</Link>
          <button onClick={toggleSound} style={{ ...styles.soundBtn, background: soundOn ? GREEN : "#4b5563" }}>
            {soundOn ? "🔊 Sound ON" : "🔇 Sound OFF"}
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
        </div>
      </header>

      {needsUnlock && (
        <div style={styles.unlockBar}>
          <span>Tap to enable kitchen alert sounds on this device</span>
          <button onClick={handleEnableSound} style={styles.unlockBtn}>Enable Kitchen Sound</button>
        </div>
      )}

      <div style={styles.board}>
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.status === col.status)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          return (
            <div key={col.status} style={styles.column}>
              <div style={{ ...styles.columnHeader, borderColor: col.color, color: col.color }}>
                {col.label} <span style={styles.count}>{colOrders.length}</span>
              </div>
              <div style={styles.columnBody}>
                {colOrders.length === 0 && <div style={styles.emptyCol}>No tickets</div>}
                {colOrders.map((o) => (
                  <div key={o._id} style={{ ...styles.card, ...(o.priority === "URGENT" ? styles.cardUrgent : {}) }}>
                    <div style={styles.cardTop}>
                      <span style={styles.orderId}>{o.orderId}</span>
                      {o.priority === "URGENT" && <span style={styles.urgentBadge}>URGENT</span>}
                    </div>
                    <div style={styles.meta}>
                      {o.tableNo ? `TABLE ${o.tableNo}` : "TAKEAWAY"} · {o.orderType === "DINE_IN" ? "DINE IN" : o.orderType}
                      {o.waiterName ? ` · WAITER: ${o.waiterName.toUpperCase()}` : ""}
                    </div>
                    <div style={styles.items}>
                      {o.items.map((it, i) => (
                        <div key={i} style={styles.itemRow}>{it.qty} × {it.name}</div>
                      ))}
                    </div>
                    {(o.notes || o.items.some((it) => it.notes)) && (
                      <div style={styles.notes}>
                        {o.notes && <div>NOTE: {o.notes}</div>}
                        {o.items.filter((it) => it.notes).map((it, i) => <div key={i}>{it.name}: {it.notes}</div>)}
                      </div>
                    )}
                    {col.status === "CONFIRMED" && (
                      <button disabled={busyId === o._id} onClick={() => handleStartPreparing(o)} style={styles.actionBtn(AMBER)}>
                        {busyId === o._id ? "…" : "▶ Start Preparing"}
                      </button>
                    )}
                    {col.action && col.status === "PREPARING" && (
                      <button disabled={busyId === o._id} onClick={() => handleAdvance(o, col.action.to)} style={styles.actionBtn(GREEN)}>
                        {busyId === o._id ? "…" : col.action.label}
                      </button>
                    )}
                    {col.status === "READY" && (
                      <div style={styles.waitingNote}>Waiting for waiter to deliver</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 20px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: BG, zIndex: 10,
  },
  soundBtn: { padding: "10px 16px", borderRadius: 10, border: "none", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", minHeight: 42 },
  logoutBtn: { padding: "10px 14px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "transparent", color: TEXT_MUTED, fontWeight: 700, fontSize: 12.5, cursor: "pointer", minHeight: 42 },
  unlockBar: { display: "flex", justifyContent: "center", alignItems: "center", gap: 16, padding: "10px 20px", background: "#78350f", color: "#fde68a", fontSize: 13.5, fontWeight: 600 },
  unlockBtn: { padding: "9px 16px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#111", fontWeight: 800, cursor: "pointer" },
  board: { display: "flex", gap: 14, padding: 16, overflowX: "auto", alignItems: "flex-start" },
  column: { flex: "1 1 320px", minWidth: 300, background: "#0f1218", borderRadius: 16, border: `1px solid ${BORDER}` },
  columnHeader: { padding: "12px 16px", fontWeight: 800, fontSize: 15, letterSpacing: 1, borderBottom: "2px solid" },
  count: { fontSize: 12, opacity: 0.7 },
  columnBody: { padding: 10, display: "flex", flexDirection: "column", gap: 10, minHeight: 200 },
  emptyCol: { textAlign: "center", padding: "40px 10px", color: TEXT_MUTED, fontSize: 13 },
  card: { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 14, animation: "popIn .25s ease" },
  cardUrgent: { border: `2px solid ${RED}`, boxShadow: "0 0 0 3px rgba(239,68,68,0.15)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  orderId: { fontSize: 17, fontWeight: 800 },
  urgentBadge: { fontSize: 10.5, fontWeight: 800, color: "#fff", background: RED, padding: "3px 9px", borderRadius: 20 },
  meta: { fontSize: 11.5, color: TEXT_MUTED, marginBottom: 8, letterSpacing: 0.3 },
  items: { display: "flex", flexDirection: "column", gap: 4, borderTop: `1px dashed ${BORDER}`, paddingTop: 8 },
  itemRow: { fontSize: 15, fontWeight: 600 },
  notes: { marginTop: 8, padding: "8px 10px", background: "rgba(245,158,11,0.1)", borderRadius: 8, fontSize: 12.5, color: "#fbbf24" },
  actionBtn: (color) => ({ marginTop: 12, width: "100%", padding: 12, borderRadius: 10, border: "none", background: color, color: "#111", fontWeight: 800, fontSize: 13.5, cursor: "pointer", minHeight: 44 }),
  waitingNote: { marginTop: 12, textAlign: "center", fontSize: 12, color: TEXT_MUTED, fontStyle: "italic" },
};
