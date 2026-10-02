import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { useVisibleInterval } from "../../hooks/useVisibleInterval.js";
import {
  updateOrderStatus, getAllOrders, getAllInvoices,
  updateInvoiceStatus, getAllTables, getInventoryOverview, getPrinterStatus,
  updateOrderPayment, confirmOrder, rejectOrder,
} from "../../services/adminService.js";
import { StockAlertsModal } from "../../components/OpsAlertsPanel.jsx";
import { t, N_, fmtNum, fmtDate, fmtTime } from "../../i18n/core.js";
import "./dashboard/dashboard.css";
import {
  ACTIVE_EXCLUDE, isToday, todaySummary, overallTotals, olderUnpaid,
  floorTables, lastSevenDays, attentionItems,
} from "./dashboard/model.js";
import AnswerCards from "./dashboard/AnswerCards.jsx";
import AttentionCard from "./dashboard/AttentionCard.jsx";
import AttentionModal from "./dashboard/AttentionModal.jsx";
import FloorCard from "./dashboard/FloorCard.jsx";
import SalesChart from "./dashboard/SalesChart.jsx";
import ActiveOrders from "./dashboard/ActiveOrders.jsx";
import { TodayDetail, TotalsCard } from "./dashboard/DetailCards.jsx";

// ── Canonical vocabulary (see restaurant-server/utils/orderStateMachine.js) ───
const STATUS_LABEL = {
  AWAITING_PAYMENT: N_("Awaiting payment"),
  PENDING_CONFIRMATION: N_("Pending"),
  CONFIRMED: N_("Placed"),
  PREPARING: N_("Preparing"),
  READY: N_("Ready"),
  DELIVERED: N_("Delivered"),
  COMPLETED: N_("Completed"),
  CANCELLED: N_("Cancelled"),
};
const TYPE_LABEL = { DINE_IN: N_("Dine-in"), TAKEAWAY: N_("Takeaway"), ONLINE: N_("Online") };

// Only the transitions the backend state machine will actually accept.
// Mirrors TRANSITIONS in restaurant-server/utils/orderStateMachine.js.
const NEXT_STATUS = {
  AWAITING_PAYMENT: ["CANCELLED"], // only a verified payment moves it forward
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const statusLabel = (s) => t(STATUS_LABEL[s] || s);
// For <Badge>, which translates its label itself — give it the English key.
const statusKey = (s) => STATUS_LABEL[s] || s;
const typeLabel = (ty) => (ty ? t(TYPE_LABEL[ty] || ty) : "—");
const money = (n) => `₹${fmtNum(Math.round(n || 0))}`;
const MODE_KEY = "adminDashMode";

// Translated sentence with its {placeholders} rendered bold (the summary line).
const rich = (text, vars) => t(text).split(/(\{\w+\})/).map((part, i) => {
  const k = part.match(/^\{(\w+)\}$/)?.[1];
  return k && k in vars ? <b key={i}>{vars[k]}</b> : part;
});

// ── Main Dashboard ──────────────────────────────────────────────────────────
export default function DashboardPage({ data, onNavigate }) {
  const s = data?.stats || {};

  const [allOrders, setAllOrders] = useState([]);
  const [allTodayOrders, setAllTodayOrders] = useState([]);
  const [invoiceMap, setInvoiceMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState(null);
  const [inv, setInv] = useState(null);
  const [printer, setPrinter] = useState(null);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [detailKind, setDetailKind] = useState(null); // attention item open in the detail modal
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) === "simple" ? "simple" : "full"; } catch { return "full"; }
  });
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage disabled */ } }, [mode]);

  // Last 1000 orders are loaded once; the 10s refresh only pulls today's +
  // still-active orders (a few dozen) and merges them in by _id.
  const fullRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const first = !fullRef.current;
      const [ordersRes, invoicesRes] = await Promise.all([
        first
          ? getAllOrders({ limit: 1000 })
          : getAllOrders({ scope: "live", since: midnight.toISOString(), limit: 1000 }),
        getAllInvoices().catch(() => ({ data: { invoices: [] } })),
      ]);
      const fetched = ordersRes.data.orders || [];
      let full = fetched;
      if (!first) {
        const fresh = new Map(fetched.map((o) => [String(o._id), o]));
        const kept = fullRef.current.map((o) => fresh.get(String(o._id)) || o);
        const known = new Set(kept.map((o) => String(o._id)));
        full = [...fetched.filter((o) => !known.has(String(o._id))), ...kept]
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      fullRef.current = full;
      const today = full.filter((o) => isToday(o.createdAt));
      const invoices = invoicesRes.data?.invoices || [];

      const activeDining = today.filter(
        (o) => o.orderType === "DINE_IN" && o.tableNo && !ACTIVE_EXCLUDE.includes(o.status),
      );
      const iMap = {};
      invoices.forEach((inv) => {
        const ids = inv.orders?.map(String) || [];
        for (const o of activeDining) {
          if (ids.includes(String(o._id))) {
            iMap[Number(o.tableNo)] = { ...inv, invoiceStatus: inv.status || inv.paymentStatus || "pending" };
            break;
          }
        }
      });

      setAllOrders(full);
      setAllTodayOrders(today);
      setInvoiceMap(iMap);
    } catch {
      toast.error(t("Failed to load data"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Stock + printer health (was the separate alerts panel above the page).
  const loadOps = useCallback(() => {
    Promise.allSettled([
      getInventoryOverview().then((r) => setInv(r.data?.data || null)),
      getPrinterStatus().then((r) => setPrinter(r.data || null)),
    ]).finally(() => setOpsLoaded(true));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { loadOps(); }, [loadOps]);
  useEffect(() => {
    getAllTables().then((r) => setTables(r.data?.tables || [])).catch(() => setTables([]));
  }, []);
  // Refresh every 10s (orders) / 20s (stock, printer) only while the tab is visible.
  useVisibleInterval(fetchData, 10000);
  useVisibleInterval(loadOps, 20000);
  // Clock + table timers.
  useVisibleInterval(() => setNow(Date.now()), 30000);

  const openNewOrder = () => {
    try { sessionStorage.setItem("adminOpenNewOrder", "1"); } catch { /* storage disabled */ }
    onNavigate?.("orders");
  };

  // "N" opens a new order, same shortcut as the Orders screen.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (showStock || detailKind) return;
      e.preventDefault();
      openNewOrder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Apply a server-confirmed change to every local copy of an order.
  const patchOrder = (id, patch) => {
    const apply = (o) => (o._id === id ? { ...o, ...patch } : o);
    setAllOrders((p) => p.map(apply));
    if (fullRef.current) fullRef.current = fullRef.current.map(apply);
    setAllTodayOrders((p) => p.map(apply));
  };

  // Record a payment (same endpoint + enum validation as Invoices / Orders).
  const handleMarkPaid = async (order, paymentMethod) => {
    try {
      const { data } = await updateOrderPayment(order._id, { paymentStatus: "PAID", paymentMethod });
      const o = data?.order; // server copy has `user` unpopulated — patch only what changed
      patchOrder(order._id, { paymentStatus: o?.paymentStatus || "PAID", paymentMethod: o?.paymentMethod || paymentMethod });
      toast.success(t("{id} marked paid", { id: order.orderId }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Update failed"));
      throw err;
    }
  };

  // Accept / reject a customer order — the same endpoints the Orders screen uses.
  const handleAccept = async (order) => {
    try {
      const { data } = await confirmOrder(order._id);
      const updated = data?.order || data;
      patchOrder(order._id, { status: updated?.status || "CONFIRMED" });
      toast.success(t("Order {id} accepted — it starts preparing shortly", { id: order.orderId }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't accept this order"));
      throw err;
    }
  };
  const handleReject = async (order) => {
    if (!window.confirm(t("Cancel order {id}? This cannot be undone. The order stays in history as cancelled.", { id: order.orderId }))) return;
    try {
      const { data } = await rejectOrder(order._id);
      const updated = data?.order || data;
      patchOrder(order._id, { status: updated?.status || "CANCELLED" });
      toast.success(t("Order {id} cancelled", { id: order.orderId }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't cancel this order"));
      throw err;
    }
  };

  const handleStatusChange = async (id, st) => {
    try {
      await updateOrderStatus(id, st);
      toast.success(`${t("Order")} → ${statusLabel(st)}`);
      setAllOrders((p) => p.map((o) => (o._id === id ? { ...o, status: st } : o)));
      if (fullRef.current) fullRef.current = fullRef.current.map((o) => (o._id === id ? { ...o, status: st } : o));
      setAllTodayOrders((p) => p.map((o) => (o._id === id ? { ...o, status: st } : o)));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Update failed"));
    }
  };

  const handleInvoiceChange = async (id, st) => {
    try {
      await updateInvoiceStatus(id, st);
      toast.success(`${t("Invoice")} → ${t(st)}`);
      await fetchData();
    } catch {
      toast.error(t("Invoice update failed"));
    }
  };

  // Every attention item opens its detail: stock → the stock modal, the rest
  // → AttentionModal with the exact orders / tables / printer state behind it.
  const handleAction = (item) => {
    if (item.action === "stock") setShowStock(true);
    else setDetailKind(item.kind);
  };

  // ── derived, all from real data ────────────────────────────────────────────
  const today = todaySummary(allTodayOrders);
  const totals = overallTotals(allOrders);
  const floor = floorTables(tables || [], allTodayOrders, invoiceMap, now);
  const pendingInvoices = Object.values(invoiceMap).filter((i) => i.invoiceStatus?.toLowerCase() === "pending").length;
  const attention = attentionItems({
    inv, printer, pendingInvoices,
    awaitingConfirm: allOrders.filter((o) => o.status === "PENDING_CONFIRMATION"),
    older: olderUnpaid(allOrders),
  });
  const days = lastSevenDays(data?.weeklyRevenue, today.collected);
  const simple = mode === "simple";

  const summary = !today.count
    ? [t("No orders yet today."), " "]
    : [rich(N_("So far today you've collected {amount} from {n} orders."), { amount: money(today.collected), n: fmtNum(today.count) }), " "];
  if (today.openAmount) summary.push(rich(N_("{amount} is still open on {n} bills."), { amount: money(today.openAmount), n: fmtNum(today.openCount) }), " ");
  summary.push(attention.length
    ? rich(attention.length === 1 ? N_("{n} thing needs your attention.") : N_("{n} things need your attention."), { n: fmtNum(attention.length) })
    : t("Nothing needs your attention."));

  return (
    <div className={`zd${simple ? " zd-simple" : ""}`}>
      {/* Header */}
      <div className="zd-mh">
        <div>
          <h2>{t("Dashboard")}</h2>
          <div className="zd-sub">
            <span>{fmtDate(now, { weekday: "long", day: "numeric", month: "long" })} · {fmtTime(now)}</span>
            <span className="zd-live"><i />{t("Live")}</span>
          </div>
        </div>
        <div className="zd-mh-r">
          <div className="zd-mseg" role="group" aria-label={t("View")}>
            <button type="button" aria-pressed={simple} onClick={() => setMode("simple")}>{t("Simple")}</button>
            <button type="button" aria-pressed={!simple} onClick={() => setMode("full")}>{t("Full")}</button>
          </div>
          {!simple && (
            <button type="button" className="zd-btn" onClick={openNewOrder}>
              + {t("New order")} <span className="zd-kbd">N</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <>
          <div className="zd-answers" aria-busy="true">
            <div className="zd-skel" /><div className="zd-skel" /><div className="zd-skel" />
          </div>
          <div className="zd-row2"><div className="zd-skel" style={{ minHeight: 260 }} /><div className="zd-skel" style={{ minHeight: 260 }} /></div>
        </>
      ) : (
        <>
          <AnswerCards today={today} onNavigate={onNavigate} />

          {simple ? (
            <div className="zd-row2">
              <AttentionCard items={attention} loading={!opsLoaded} onAction={handleAction} />
              <div className="zd-card">
                <div className="zd-ch"><h3>{t("In one line")}</h3></div>
                <p className="zd-summary">{summary}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="zd-row2">
                <AttentionCard items={attention} loading={!opsLoaded} onAction={handleAction} />
                <FloorCard
                  tables={floor}
                  tablesLoaded={tables !== null}
                  nextStatus={NEXT_STATUS}
                  statusLabel={statusLabel}
                  statusKey={statusKey}
                  onStatusChange={handleStatusChange}
                  onInvoiceStatusChange={handleInvoiceChange}
                  onNavigate={onNavigate}
                />
              </div>
              <div className="zd-row3">
                <SalesChart days={days} />
                <TodayDetail today={today} statusLabel={statusLabel} typeLabel={typeLabel} />
              </div>
              <div className="zd-row3">
                <ActiveOrders
                  orders={allTodayOrders}
                  nextStatus={NEXT_STATUS}
                  statusLabel={statusLabel}
                  statusKey={statusKey}
                  typeLabel={typeLabel}
                  onStatusChange={handleStatusChange}
                />
                <TotalsCard totals={totals} stats={s} />
              </div>
            </>
          )}
        </>
      )}

      {detailKind && (
        <AttentionModal
          // Re-read from the live list each render, so a row disappears as soon as it's settled.
          item={attention.find((a) => a.kind === detailKind) || { kind: detailKind, orders: [] }}
          pendingTables={floor.filter((tb) => tb.billPending && tb.invoice)}
          printer={printer}
          typeLabel={typeLabel}
          statusKey={statusKey}
          onMarkPaid={handleMarkPaid}
          onAccept={handleAccept}
          onReject={handleReject}
          onInvoiceStatusChange={handleInvoiceChange}
          onNavigate={onNavigate}
          onClose={() => setDetailKind(null)}
        />
      )}

      {showStock && inv && (
        <StockAlertsModal inv={inv} onClose={() => setShowStock(false)} onNavigate={onNavigate} />
      )}
    </div>
  );
}
