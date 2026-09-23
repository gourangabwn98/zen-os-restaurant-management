import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getAllTables, getOpenTableSessions } from "../services/tableService.js";
import { getAllOrders, confirmOrder, rejectOrder } from "../services/orderService.js";
import { OccupiedTableCard, FreeTableCard } from "../components/TableCard.jsx";
import DutyPanel from "../components/DutyPanel.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import {
  classifyTable, summarize, STATUS_META,
  formatElapsed, elapsedMinutes, runningTotal, activeOrders,
} from "../utils/tableSession.js";
import { NAV_HEIGHT } from "../theme.js";

const AMBER = "#F5B83D";

const BellIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

const BG = "#0B0E13";
const CARD_BG = "#131820";
const CARD_BORDER = "#1F2733";
const TEXT_MUTED = "#9AA4B2";
const TEXT_MAIN  = "#E8ECF2";
const FONT_HEAD = "'Bricolage Grotesque', sans-serif";
const FONT_BODY = "'IBM Plex Sans', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";
const ACCENT = "#6AA8FF";

export default function TablesPage() {
  const nav = useNavigate();
  const [tables, setTables]     = useState(null);
  const [sessions, setSessions] = useState({});
  const [error, setError]       = useState(null);
  const [selected, setSelected] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [showPending, setShowPending] = useState(false);
  const [busyId, setBusyId]     = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tRes, sRes, pRes] = await Promise.all([
        getAllTables(), getOpenTableSessions(), getAllOrders({ status: "PENDING_CONFIRMATION", limit: 50 }),
      ]);
      setTables(tRes.data?.tables || []);
      const map = {};
      (sRes.data?.sessions || []).forEach((s) => { map[Number(s.tableNo)] = s; });
      setSessions(map);
      setPendingOrders(pRes.data?.orders || []);
    } catch {
      setError("Couldn't load tables");
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  // Forces a re-render every minute so each card's "since seated" timer and
  // its color band advance live without waiting on the next data refetch.
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  const handleConfirm = async (order) => {
    setBusyId(order._id);
    try {
      await confirmOrder(order._id);
      toast.success(`Order ${order.orderId} confirmed · KOT sent`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't confirm order");
    } finally { setBusyId(null); }
  };

  const handleReject = async (order) => {
    if (!window.confirm(`Reject order ${order.orderId}?`)) return;
    setBusyId(order._id);
    try {
      await rejectOrder(order._id, "Rejected by waiter");
      toast.success("Order rejected");
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't reject order");
    } finally { setBusyId(null); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (tables === null) return <Loader label="Loading tables…" />;

  const liveTables = tables.filter((t) => t.status !== "Inactive").sort((a, b) => a.tableNo - b.tableNo);
  const classified = liveTables.map((t) => classifyTable(t, sessions[t.tableNo]));
  const summary = summarize(classified);

  const selectedClassified = selected ? classified.find((c) => c.table.tableNo === selected) : null;
  const selectedSession = selected ? sessions[selected] : null;

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 90, background: BG, minHeight: "100vh", fontFamily: FONT_BODY }}>
      {/* Header — title and the "Awaiting confirmation" button always share
          the top row (never wrap to separate lines); subtitle + occupied
          count sit on their own row underneath. */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 800, color: TEXT_MAIN, letterSpacing: -0.5, flexShrink: 0 }}>Tables</div>

          <button
            type="button"
            onClick={() => setShowPending(true)}
            className="pressable"
            aria-label={`Awaiting confirmation, ${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"}`}
            style={{
              display: "flex", alignItems: "center", gap: 5, minHeight: 32, padding: "0 10px", borderRadius: 999,
              border: `1px solid ${pendingOrders.length ? `${AMBER}80` : CARD_BORDER}`,
              background: pendingOrders.length ? `${AMBER}24` : CARD_BG,
              color: pendingOrders.length ? "#F5C565" : TEXT_MUTED,
              fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT_BODY, whiteSpace: "nowrap",
              animation: pendingOrders.length ? "pulseAmberGlow 1.8s ease-in-out infinite" : "none",
              minWidth: 0, overflow: "hidden",
            }}
          >
            <BellIcon />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Pending</span>
            {pendingOrders.length > 0 && (
              <span style={{
                minWidth: 16, height: 16, borderRadius: 999, background: AMBER, color: "#0B0E13",
                fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", flexShrink: 0,
              }}>
                {pendingOrders.length}
              </span>
            )}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11.5, color: TEXT_MUTED, maxWidth: 320 }}>
            Tap a table to see its orders or start a new one.
          </div>
          {classified.length > 0 && (
            <div style={{ fontSize: 10.5, color: TEXT_MUTED, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
              <span style={{ fontFamily: FONT_MONO, color: TEXT_MAIN, fontWeight: 700 }}>{summary.occupied}</span> of {classified.length} occupied
            </div>
          )}
        </div>
      </div>

      {/* Duty toggle — moved here from Profile so a waiter can clock in/out
          without leaving the screen they actually work from. */}
      <div style={{ margin: "10px 16px 0", padding: "10px 14px", background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 16 }}>
        <DutyPanel />
      </div>

      {/* Grid — just the tables, nothing else on this page. */}
      {classified.length === 0 ? (
        <EmptyBoard title="No tables set up yet" sub="Ask an admin to add tables" />
      ) : (
        <div className="tables-grid" style={{ padding: "16px 16px 0" }}>
          {classified.map((c) =>
            c.occupied ? (
              <OccupiedTableCard
                key={c.table.tableNo}
                classified={c}
                active={selected === c.table.tableNo}
                onClick={() => setSelected(selected === c.table.tableNo ? null : c.table.tableNo)}
              />
            ) : (
              <FreeTableCard
                key={c.table.tableNo}
                table={c.table}
                onClick={() => nav(`/new-order?table=${c.table.tableNo}`)}
              />
            )
          )}
        </div>
      )}

      {/* Selected occupied table — its active orders, as a modal (not an
          inline block the page had to be scrolled down to reach). */}
      {selectedClassified && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
            display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "80vh", overflowY: "auto",
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderBottom: "none",
              borderRadius: "20px 20px 0 0", fontFamily: FONT_BODY,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0" }}>
              <span style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
            </div>

            <div style={{
              padding: "10px 16px 14px", borderBottom: `1px solid ${CARD_BORDER}`, display: "flex",
              justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: CARD_BG, zIndex: 1,
            }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 16, color: TEXT_MAIN }}>Table {selected}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => nav(`/new-order?table=${selected}`)}
                  style={{
                    minHeight: 40, padding: "0 16px", borderRadius: 999, border: "none", cursor: "pointer",
                    background: ACCENT, color: "#0B0E13", fontWeight: 800, fontSize: 12, fontFamily: FONT_BODY,
                  }}
                >
                  + Add order
                </button>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  style={{
                    width: 36, height: 36, borderRadius: "50%", border: `1px solid ${CARD_BORDER}`,
                    background: "rgba(255,255,255,0.04)", color: TEXT_MAIN, fontSize: 15, cursor: "pointer", flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, padding: "12px 16px", fontSize: 11.5, color: TEXT_MUTED }}>
              <span><ReceiptCount count={selectedClassified.orderCount} /></span>
              {selectedClassified.placedAt && (
                <span>
                  since seated ·{" "}
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: TEXT_MAIN }}>
                    {formatElapsed(elapsedMinutes(selectedClassified.placedAt))}
                  </span>
                </span>
              )}
              <span>
                running ·{" "}
                <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: TEXT_MAIN }}>₹{runningTotal(selectedSession?.orders)}</span>
              </span>
            </div>

            <div style={{ padding: "4px 10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {activeOrders(selectedSession?.orders).map((o) => (
                <OrderRow key={o._id} order={o} onClick={() => nav(`/order/${o._id}`)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Awaiting-confirmation modal — every PENDING_CONFIRMATION order
          across the whole board, not just dine-in tables (a takeaway/
          online order has no table session to surface it from). */}
      {showPending && (
        <div
          onClick={() => setShowPending(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
            display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "80vh", overflowY: "auto",
              background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderBottom: "none",
              borderRadius: "20px 20px 0 0", fontFamily: FONT_BODY,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0" }}>
              <span style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
            </div>

            <div style={{
              padding: "10px 16px 14px", borderBottom: `1px solid ${CARD_BORDER}`, display: "flex",
              justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: CARD_BG, zIndex: 1,
            }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 16, color: TEXT_MAIN }}>
                Awaiting confirmation
                <span style={{ marginLeft: 8, fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: TEXT_MUTED }}>
                  {pendingOrders.length}
                </span>
              </div>
              <button
                onClick={() => setShowPending(false)}
                aria-label="Close"
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: `1px solid ${CARD_BORDER}`,
                  background: "rgba(255,255,255,0.04)", color: TEXT_MAIN, fontSize: 15, cursor: "pointer", flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "12px 10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {pendingOrders.length === 0 ? (
                <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: TEXT_MUTED }}>
                  Nothing waiting on confirmation right now.
                </div>
              ) : (
                pendingOrders.map((o) => (
                  <PendingOrderRow
                    key={o._id}
                    order={o}
                    busy={busyId === o._id}
                    onOpen={() => { setShowPending(false); nav(`/order/${o._id}`); }}
                    onConfirm={() => handleConfirm(o)}
                    onReject={() => handleReject(o)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyBoard({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px", animation: "fadeUp .3s ease" }}>
      <div style={{
        width: 64, height: 64, margin: "0 auto 16px", borderRadius: "50%",
        background: CARD_BG, border: `1px solid ${CARD_BORDER}`, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={TEXT_MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" />
          <rect x="3" y="13" width="7" height="7" rx="1.5" /><rect x="14" y="13" width="7" height="7" rx="1.5" />
        </svg>
      </div>
      <div style={{ fontFamily: FONT_HEAD, fontSize: 15, fontWeight: 800, color: TEXT_MAIN }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function ReceiptCount({ count }) {
  return <>{count} order{count === 1 ? "" : "s"}</>;
}

function OrderRow({ order, onClick }) {
  const meta = STATUS_META[order.status] || { label: order.status, color: TEXT_MUTED };
  const items = (order.items || []).slice(0, 3).map((i) => `${i.name} ×${i.qty}`).join(", ");
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable"
      aria-label={`${order.orderId}, ${meta.label}, ₹${order.total}`}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left",
        minHeight: 44, width: "100%", padding: "10px 12px", cursor: "pointer",
        background: `${meta.color}12`, border: `1px solid ${meta.color}3D`, borderRadius: 12,
        fontFamily: FONT_BODY, color: TEXT_MAIN,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>{order.orderId}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: meta.color }}>{meta.label}</span>
        </div>
        {items && <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{items}</div>}
      </div>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 13.5, flexShrink: 0 }}>₹{order.total}</span>
    </button>
  );
}

function PendingOrderRow({ order, busy, onOpen, onConfirm, onReject }) {
  const items = (order.items || []).slice(0, 3).map((i) => `${i.name} ×${i.qty}`).join(", ");
  const where = order.orderType === "DINE_IN" ? `Table ${order.tableNo}` : "Takeaway";
  const who = order.guestName || order.user?.name || "Guest";
  return (
    <div style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}40`, borderRadius: 14, padding: "12px 12px" }}>
      <div onClick={onOpen} role="button" tabIndex={0} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: TEXT_MAIN }}>{order.orderId}</span>
              <span style={{ fontSize: 10.5, color: TEXT_MUTED }}>{where} · {who}</span>
            </div>
            {items && <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 5 }}>{items}{order.items?.length > 3 ? ` +${order.items.length - 3} more` : ""}</div>}
            <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 4 }}>
              {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 15, color: TEXT_MAIN, flexShrink: 0 }}>₹{order.total}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{
            flex: 1, minHeight: 38, borderRadius: 10, border: "none", cursor: busy ? "not-allowed" : "pointer",
            background: "#3DD68C", color: "#0B0E13", fontWeight: 800, fontSize: 12, fontFamily: FONT_BODY,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "…" : "✓ Confirm"}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          style={{
            flex: 1, minHeight: 38, borderRadius: 10, cursor: busy ? "not-allowed" : "pointer",
            border: "1.5px solid rgba(255,138,138,0.5)", background: "rgba(255,138,138,0.1)",
            color: "#FF8A8A", fontWeight: 800, fontSize: 12, fontFamily: FONT_BODY, opacity: busy ? 0.6 : 1,
          }}
        >
          ✕ Reject
        </button>
      </div>
    </div>
  );
}
