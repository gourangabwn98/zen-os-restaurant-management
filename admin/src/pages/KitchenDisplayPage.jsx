// src/pages/KitchenDisplayPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// A dedicated, full-screen Kitchen Display — no sidebar, large touch-friendly
// UI, meant to be opened once on a kitchen tablet and left running.
//
// Sound correctness (see utils/kitchenAlertSound.js for the tones themselves):
//   - `seenJobIds` (a ref-backed Set, not state) is the single source of
//     truth for "have we already shown/alerted this KOT job?". Every path
//     that adds a ticket to the screen — initial load, reconnect backfill,
//     or a live kot:created push — checks it first. Only a job id that has
//     genuinely never been seen in this page session triggers a sound.
//   - Because it's a ref (not React state), it survives re-renders, tab/
//     filter changes, and socket reconnects without resetting — a browser
//     refresh is the only thing that legitimately resets it, which is
//     correct: a fresh page load should show today's active tickets
//     silently, not re-alert for every one of them.
//   - The socket's own "connect" event (fires on first connect AND every
//     reconnect) triggers a silent re-fetch of currently-active orders to
//     backfill anything missed while disconnected — never a sound.
//   - Only the live `kot:created` event, for a job id not already in
//     `seenJobIds`, ever calls playNewOrderAlert()/playUrgentOrderAlert().
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSocket } from "../services/socketService.js";
import { getAllOrders } from "../services/adminService.js";
import {
  playNewOrderAlert, playUrgentOrderAlert, unlockAudio, isAudioUnlocked,
} from "../utils/kitchenAlertSound.js";

const SOUND_PREF_KEY = "kitchenSoundEnabled";
const ACTIVE_STATUSES = ["CONFIRMED", "PREPARING"];

const loadSoundPref = () => {
  const raw = localStorage.getItem(SOUND_PREF_KEY);
  return raw === null ? true : raw === "true"; // default ON
};

const ticketFromKotJob = (kotJob) => ({
  jobId: String(kotJob._id),
  orderId: kotJob.orderId,
  tableNo: kotJob.tableNo,
  orderType: kotJob.orderType,
  items: kotJob.items || [],
  priority: kotJob.priority || "NORMAL",
  receivedAt: new Date(),
});

const ticketFromOrder = (order) => ({
  jobId: `order:${order._id}`,
  orderId: order.orderId,
  tableNo: order.tableNo,
  orderType: order.orderType,
  items: order.items || [],
  priority: order.priority || "NORMAL",
  receivedAt: new Date(order.createdAt || Date.now()),
});

export default function KitchenDisplayPage() {
  const nav = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [soundOn, setSoundOn] = useState(loadSoundPref);
  const [needsUnlock, setNeedsUnlock] = useState(!isAudioUnlocked());
  const [connected, setConnected] = useState(false);
  const seenJobIds = useRef(new Set());

  const addTicketSilently = useCallback((ticket) => {
    if (seenJobIds.current.has(ticket.jobId)) return;
    seenJobIds.current.add(ticket.jobId);
    setTickets((prev) => [ticket, ...prev]);
  }, []);

  const addTicketWithAlert = useCallback((ticket) => {
    if (seenJobIds.current.has(ticket.jobId)) return;
    seenJobIds.current.add(ticket.jobId);
    setTickets((prev) => [ticket, ...prev]);

    if (!loadSoundPref()) return;
    const played = ticket.priority === "URGENT" ? playUrgentOrderAlert() : playNewOrderAlert();
    if (!played) setNeedsUnlock(true);
  }, []);

  const backfillActiveOrders = useCallback(async () => {
    try {
      const { data } = await getAllOrders({ limit: 100 });
      const active = (data.orders || []).filter((o) => ACTIVE_STATUSES.includes(o.status));
      active.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      active.forEach((o) => addTicketSilently(ticketFromOrder(o)));
    } catch {
      /* transient — the live socket feed still works; next reconnect retries */
    }
  }, [addTicketSilently]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) { nav("/login", { replace: true }); return; }

    const onConnect = () => { setConnected(true); backfillActiveOrders(); };
    const onDisconnect = () => setConnected(false);
    const onKotCreated = (payload) => {
      const kotJob = payload?.kotJob || payload;
      if (!kotJob?._id) return;
      addTicketWithAlert(ticketFromKotJob(kotJob));
    };
    const onStatusChanged = (payload) => {
      const order = payload?.order;
      if (!order || ACTIVE_STATUSES.includes(order.status)) return;
      setTickets((prev) => prev.filter((t) => !t.orderId || t.orderId !== order.orderId));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("kot:created", onKotCreated);
    socket.on("order:status_changed", onStatusChanged);
    socket.on("order:cancelled", onStatusChanged);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("kot:created", onKotCreated);
      socket.off("order:status_changed", onStatusChanged);
      socket.off("order:cancelled", onStatusChanged);
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

  const dismiss = (jobId) => setTickets((prev) => prev.filter((t) => t.jobId !== jobId));

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.title}>🍳 Kitchen Display</span>
          <span style={{ ...styles.statusDot, background: connected ? "#22c55e" : "#ef4444" }} />
          <span style={styles.statusLabel}>{connected ? "Live" : "Reconnecting…"}</span>
        </div>
        <div style={styles.headerRight}>
          <button onClick={toggleSound} style={{ ...styles.soundBtn, background: soundOn ? "#16a34a" : "#4b5563" }}>
            {soundOn ? "🔊 Sound ON" : "🔇 Sound OFF"}
          </button>
          <button onClick={() => nav("/admin")} style={styles.backBtn}>← Admin</button>
        </div>
      </header>

      {needsUnlock && (
        <div style={styles.unlockBar}>
          <span>Tap to enable kitchen alert sounds on this device</span>
          <button onClick={handleEnableSound} style={styles.unlockBtn}>Enable Kitchen Sound</button>
        </div>
      )}

      {tickets.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: 56 }}>🧾</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 12 }}>No active tickets</div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginTop: 4 }}>New confirmed orders will appear here automatically.</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {tickets.map((t) => (
            <div key={t.jobId} style={{ ...styles.card, ...(t.priority === "URGENT" ? styles.cardUrgent : {}) }}>
              <div style={styles.cardHeader}>
                <span style={styles.orderId}>{t.orderId}</span>
                {t.priority === "URGENT" && <span style={styles.urgentBadge}>URGENT</span>}
              </div>
              <div style={styles.cardMeta}>
                {t.tableNo ? `Table ${t.tableNo}` : (t.orderType || "Takeaway")}
                {" · "}
                {t.receivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div style={styles.itemsList}>
                {t.items.map((it, i) => (
                  <div key={i} style={styles.itemRow}>
                    <span style={styles.itemQty}>{it.qty}×</span>
                    <span>{it.name}</span>
                    {it.notes && <span style={styles.itemNote}>"{it.notes}"</span>}
                  </div>
                ))}
              </div>
              <button onClick={() => dismiss(t.jobId)} style={styles.dismissBtn}>✓ Done</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0b0d12", color: "#f3f4f6", fontFamily: "'DM Sans', sans-serif" },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)",
    position: "sticky", top: 0, background: "#0b0d12", zIndex: 10,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontWeight: 800 },
  statusDot: { width: 10, height: 10, borderRadius: "50%", marginLeft: 6 },
  statusLabel: { fontSize: 13, color: "#9ca3af" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  soundBtn: {
    padding: "12px 20px", borderRadius: 12, border: "none", color: "#fff",
    fontWeight: 800, fontSize: 15, cursor: "pointer", minHeight: 48,
  },
  backBtn: {
    padding: "12px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#d1d5db", fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 48,
  },
  unlockBar: {
    display: "flex", justifyContent: "center", alignItems: "center", gap: 16,
    padding: "12px 20px", background: "#78350f", color: "#fde68a", fontSize: 14, fontWeight: 600,
  },
  unlockBtn: {
    padding: "10px 18px", borderRadius: 10, border: "none", background: "#f59e0b",
    color: "#111", fontWeight: 800, cursor: "pointer", minHeight: 44,
  },
  empty: { textAlign: "center", padding: "100px 20px" },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 16, padding: 20,
  },
  card: {
    background: "#161a22", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
    padding: 18, display: "flex", flexDirection: "column", gap: 10,
  },
  cardUrgent: { border: "2px solid #ef4444", boxShadow: "0 0 0 3px rgba(239,68,68,0.15)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 19, fontWeight: 800 },
  urgentBadge: {
    fontSize: 11, fontWeight: 800, color: "#fff", background: "#ef4444",
    padding: "4px 10px", borderRadius: 20, letterSpacing: 0.5,
  },
  cardMeta: { fontSize: 13.5, color: "#9ca3af" },
  itemsList: { display: "flex", flexDirection: "column", gap: 6, borderTop: "1px dashed rgba(255,255,255,0.12)", paddingTop: 10 },
  itemRow: { display: "flex", gap: 8, fontSize: 16, alignItems: "baseline" },
  itemQty: { fontWeight: 800, color: "#60a5fa", minWidth: 28 },
  itemNote: { fontSize: 13, color: "#fbbf24", fontStyle: "italic" },
  dismissBtn: {
    marginTop: 8, padding: "12px", borderRadius: 10, border: "none",
    background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer", minHeight: 48,
  },
};
