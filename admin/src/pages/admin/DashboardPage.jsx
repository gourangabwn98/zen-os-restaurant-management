import { useState, useEffect, useCallback } from "react";
import { needsPaidFirst, PAID_FIRST_HINT } from "./shared/paymentRules.js";
import toast from "react-hot-toast";
import {
  updateOrderStatus, getAllOrders, getAllInvoices,
  updateInvoiceStatus, getAllTables,
} from "../../services/adminService.js";
import StatCard from "./shared/StatCard.jsx";
import Badge from "./shared/Badge.jsx";
import { statusKind } from "./shared/statusKind.js";
import { RankedBars, SegmentedBar, Meter, TrendChart, CAT_COLORS } from "./shared/charts.jsx";
import { t, tn, N_, fmtNum, fmtTime, fmtDate, localName } from "../../i18n/core.js";

// ── Canonical vocabulary (see restaurant-server/utils/orderStateMachine.js) ───
const ALL_STATUSES = [
  "AWAITING_PAYMENT", "PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY",
  "DELIVERED", "COMPLETED", "CANCELLED",
];
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
// "not on the floor": finished, or a pay-first order nobody has paid for yet
const ACTIVE_EXCLUDE = ["COMPLETED", "CANCELLED", "AWAITING_PAYMENT"];

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

const KIND_INK  = { wait: "var(--wait-ink)",  live: "var(--live-ink)",  ready: "var(--ready-ink)",  done: "var(--done-ink)",  stop: "var(--stop-ink)",  vio: "var(--accent-ink)" };
const KIND_FILL = { wait: "var(--wait-fill)", live: "var(--live-fill)", ready: "var(--ready-fill)", done: "var(--done-fill)", stop: "var(--stop-fill)", vio: "var(--violet-weak)" };

const statusLabel = (s) => t(STATUS_LABEL[s] || s);
const typeLabel = (ty) => (ty ? t(TYPE_LABEL[ty] || ty) : "—");

const AVATAR_GRADS = [
  "linear-gradient(140deg,#8B5CF6,#6D28D9)",
  "linear-gradient(140deg,#22D3EE,#0891B2)",
  "linear-gradient(140deg,#F0A93B,#D97706)",
  "linear-gradient(140deg,#35D08A,#059669)",
  "linear-gradient(140deg,#F2564D,#B91C1C)",
  "linear-gradient(140deg,#6366F1,#4338CA)",
];

// ── inject page-scoped keyframes ─────────────────────────────────────────────
if (!document.getElementById("dash-styles")) {
  const s = document.createElement("style");
  s.id = "dash-styles";
  s.textContent = `
    @keyframes dashBlink {
      0%,100%{ box-shadow:0 0 0 0 rgba(242,86,77,0); }
      50%{ box-shadow:0 0 0 4px rgba(242,86,77,0.28); }
    }
    .dash-blink{ animation:dashBlink 1.4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce){ .dash-blink{ animation-duration:0s; } }
    .dash-cols{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.1fr); gap:16px; }
    @media (max-width: 960px){ .dash-cols{ grid-template-columns:1fr; } }
    @media (max-width: 1100px){ .dash-charts-row{ grid-template-columns:1fr 1fr !important; } }
    @media (max-width: 700px){ .dash-charts-row{ grid-template-columns:1fr !important; } }
  `;
  document.head.appendChild(s);
}

// ── helpers ─────────────────────────────────────────────────────────────────
const isToday = (d) => {
  const dt = new Date(d), n = new Date();
  return dt.getFullYear() === n.getFullYear() && dt.getMonth() === n.getMonth() && dt.getDate() === n.getDate();
};
const initials = (n) => !n || n === "Guest" ? "G"
  : n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
const avatarGrad = (s) => AVATAR_GRADS[(s?.charCodeAt(0) || 0) % AVATAR_GRADS.length];
const fmt = (n) => fmtNum(Math.round(n || 0));

// ── real-data sparkline (area + stroke, no library — matches the reference) ──
function Sparkline({ values, stroke = "var(--violet)" }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 120;
    const y = 48 - ((v - min) / range) * 40;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  return (
    <svg className="spark" viewBox="0 0 120 52" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L120,52 L0,52 Z`} fill={stroke} opacity="0.12" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── section label ───────────────────────────────────────────────────────────
const SectionLabel = ({ children, style }) => (
  <div style={{
    fontSize: 11, fontWeight: 700, color: "var(--accent-ink)", letterSpacing: 1.4,
    textTransform: "uppercase", marginBottom: 12, ...style,
  }}>
    {children}
  </div>
);

// ── Orders-by-status summary ────────────────────────────────────────────────
function StatusSummary({ orders }) {
  const counts = {};
  for (const o of orders) {
    if (!counts[o.status]) counts[o.status] = { count: 0, revenue: 0 };
    counts[o.status].count++;
    counts[o.status].revenue += Number(o.total || 0);
  }
  const total = {
    count: orders.length,
    revenue: orders.reduce((s, o) => s + Number(o.total || 0), 0),
  };

  const cells = [
    ...ALL_STATUSES.map((st) => ({
      label: statusLabel(st),
      kind: statusKind(st),
      ...(counts[st] || { count: 0, revenue: 0 }),
    })),
    { label: t("Total"), kind: "vio", ...total },
  ];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
      gap: 8, marginBottom: 20,
    }}>
      {cells.map((c) => (
        <div key={c.label} style={{
          background: KIND_FILL[c.kind], borderRadius: "var(--r-row)",
          border: "1px solid var(--edge)",
          padding: "10px 12px", textAlign: "center",
        }}>
          <div style={{ fontSize: 10.5, color: KIND_INK[c.kind], fontWeight: 700, marginBottom: 4 }}>
            {c.label}
          </div>
          <div className="tnum" style={{ fontSize: 21, fontWeight: 700, color: KIND_INK[c.kind] }}>
            {fmtNum(c.count)}
          </div>
          <div className="tnum" style={{ fontSize: 10, color: KIND_INK[c.kind], opacity: 0.75, marginTop: 2 }}>
            ₹{fmt(c.revenue)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live table map ──────────────────────────────────────────────────────────
function TableMap({ orders, invoiceMap, onStatusChange, onInvoiceStatusChange }) {
  const [activeTable, setActiveTable] = useState(null);
  const [tables, setTables] = useState([]);

  useEffect(() => {
    getAllTables().then((r) => setTables(r.data?.tables || [])).catch(() => setTables([]));
  }, []);

  const tableOrderMap = {};
  orders
    .filter((o) => o.orderType === "DINE_IN" && o.tableNo && !ACTIVE_EXCLUDE.includes(o.status))
    .forEach((o) => { tableOrderMap[Number(o.tableNo)] = o; });

  const selOrder = activeTable ? tableOrderMap[activeTable] || null : null;
  const selInv = activeTable ? invoiceMap[activeTable] || null : null;
  const isPending = selInv?.invoiceStatus?.toLowerCase() === "pending";

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {tables.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 12, padding: "16px 0" }}>{t("Loading tables…")}</div>
        ) : (
          tables
            .filter((tb) => tb.status === "Active" || !tb.status)
            .sort((a, b) => a.tableNo - b.tableNo)
            .map((tb) => {
              const o = tableOrderMap[tb.tableNo];
              const inv = invoiceMap[tb.tableNo];
              const pend = inv?.invoiceStatus?.toLowerCase() === "pending";
              const kind = o ? (pend ? "stop" : statusKind(o.status)) : null;
              const isActive = activeTable === tb.tableNo;
              return (
                <div
                  key={tb.tableNo}
                  className={pend ? "dash-blink" : ""}
                  onClick={() => setActiveTable(isActive ? null : tb.tableNo)}
                  style={{
                    borderRadius: "var(--r-row)", padding: "8px 14px", cursor: "pointer",
                    background: kind ? KIND_FILL[kind] : "var(--card-2)",
                    border: isActive
                      ? "2px solid var(--violet)"
                      : `1px solid ${pend ? "var(--stop-line)" : "var(--edge)"}`,
                    minWidth: 80, textAlign: "center", transition: "border-color .12s",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: kind ? KIND_INK[kind] : "var(--text-3)" }}>
                    {t("T{n}", { n: tb.tableNo })}
                  </div>
                  <div style={{ fontSize: 10, color: kind ? KIND_INK[kind] : "var(--text-3)", marginTop: 2 }}>
                    {pend ? t("Payment due") : o ? statusLabel(o.status) : t("Free")}
                  </div>
                </div>
              );
            })
        )}
      </div>

      {activeTable && (
        <div style={{
          marginTop: 12, background: "var(--card-2)", borderRadius: "var(--r-row)",
          border: `1px solid ${isPending ? "var(--stop-line)" : "var(--edge)"}`, padding: 14,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-1)" }}>{t("Table {n}", { n: activeTable })}</span>
              {selOrder && (
                <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 8 }}>
                  {selOrder.orderId} · {selOrder.user?.name || selOrder.guestName || t("Guest")}
                </span>
              )}
              {isPending && (
                <span className="zc-tag stop" style={{ marginLeft: 8 }}><i />{t("Invoice pending")}</span>
              )}
            </div>
            <button type="button" onClick={() => setActiveTable(null)} className="zc-x" aria-label={t("Close")}>✕</button>
          </div>

          {!selOrder ? (
            <div style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>
              {t("This table is free — no active order")}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{t("Items")}</div>
                {selOrder.items?.map((item, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "5px 0", borderBottom: "1px solid var(--edge)", fontSize: 12,
                  }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 5, background: "var(--violet-weak)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, color: "var(--accent-ink)",
                      }}>
                        {fmtNum(item.qty)}
                      </div>
                      <span style={{ color: "var(--text-1)" }}>{localName(item)}</span>
                    </div>
                    <span className="tnum" style={{ color: "var(--text-1)", fontWeight: 500 }}>₹{fmtNum(item.price * item.qty)}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--edge)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15 }}>
                    <span style={{ color: "var(--text-1)" }}>{t("Total")}</span>
                    <span className="tnum" style={{ color: "var(--accent-ink)" }}>₹{fmt(selOrder.total)}</span>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{t("Update order")}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
                  {(NEXT_STATUS[selOrder.status] || []).map((s) => {
                    const k = statusKind(s);
                    const blocked = needsPaidFirst(selOrder, s);
                    return (
                      <button
                        type="button"
                        key={s}
                        disabled={blocked}
                        title={blocked ? t(PAID_FIRST_HINT) : undefined}
                        onClick={() => { if (blocked) return; onStatusChange(selOrder._id, s); setActiveTable(null); }}
                        style={{
                          padding: "5px 10px", borderRadius: 20, fontSize: 11, cursor: blocked ? "not-allowed" : "pointer",
                          opacity: blocked ? 0.45 : 1,
                          border: "1px solid var(--edge-hi)", font: "inherit",
                          background: KIND_FILL[k], color: KIND_INK[k], fontWeight: 600,
                        }}
                      >
                        {statusLabel(s)}
                      </button>
                    );
                  })}
                  {(NEXT_STATUS[selOrder.status] || []).length === 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("No further changes")}</span>
                  )}
                </div>
                {selInv && isPending && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { onInvoiceStatusChange(selInv._id, "completed"); setActiveTable(null); }}
                      className="zc-btn good" style={{ flex: 1, justifyContent: "center" }}
                    >
                      {t("Mark paid")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { onInvoiceStatusChange(selInv._id, "cancelled"); setActiveTable(null); }}
                      className="zc-btn danger" style={{ flex: 1, justifyContent: "center" }}
                    >
                      {t("Cancel")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recent orders panel ─────────────────────────────────────────────────────
function OrderList({ orders, onStatusChange }) {
  const [type, setType] = useState("all");
  const active = orders.filter((o) => !ACTIVE_EXCLUDE.includes(o.status));
  const dining = active.filter((o) => o.orderType === "DINE_IN");
  const takeaway = active.filter((o) => o.orderType === "TAKEAWAY");
  const visible = type === "dining" ? dining : type === "takeaway" ? takeaway : active;

  const tabs = [
    { key: "all", label: t("All orders"), count: active.length },
    { key: "dining", label: t("Dine-in"), count: dining.length },
    { key: "takeaway", label: t("Takeaway"), count: takeaway.length },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((b) => (
          <button
            type="button"
            key={b.key}
            onClick={() => setType(b.key)}
            style={{
              flex: 1, textAlign: "center", cursor: "pointer", borderRadius: "var(--r-ctl)",
              padding: "11px 8px", font: "inherit",
              border: type === b.key ? "2px solid var(--violet)" : "1px solid var(--edge)",
              background: type === b.key ? "var(--violet-weak)" : "var(--card-2)",
              transition: "border-color .15s",
            }}
          >
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>{fmtNum(b.count)}</div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>{b.label}</div>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-3)", fontSize: 13 }}>
          {t("No active orders")}
        </div>
      ) : visible.map((o) => (
        <div key={o._id} style={{
          display: "flex", gap: 10, alignItems: "flex-start",
          padding: "11px 0", borderBottom: "1px solid var(--edge)",
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            background: avatarGrad(o.guestName || o.user?.name || "Guest"), color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {initials(o.guestName || o.user?.name)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-1)" }}>
                  {o.guestName || o.user?.name || t("Admin")}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 6 }}>{o.orderId}</span>
              </div>
              <span className="tnum" style={{ fontWeight: 700, fontSize: 14, color: "var(--accent-ink)" }}>₹{fmt(o.total)}</span>
            </div>
            <div style={{
              fontSize: 12, color: "var(--text-2)", marginBottom: 6,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {o.items?.map((i) => `${localName(i)} ×${fmtNum(i.qty)}`).join(", ")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <Badge label={o.status} format={statusLabel} />
              <Badge label={o.orderType} kind="vio" format={typeLabel} dot={false} />
              {o.tableNo && (
                <span style={{
                  fontSize: 11, color: "var(--text-3)",
                  background: "var(--card-2)", borderRadius: 20, padding: "2px 8px",
                }}>
                  {t("Table {n}", { n: o.tableNo })}
                </span>
              )}
              <span className="tnum" style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                {fmtTime(o.createdAt)}
              </span>
            </div>
            {(NEXT_STATUS[o.status] || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <select
                  className="zc-select"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) onStatusChange(o._id, e.target.value); }}
                  style={{ width: "auto", fontSize: 11, padding: "5px 10px", cursor: "pointer" }}
                >
                  <option value="" disabled>{t("Update status…")}</option>
                  {NEXT_STATUS[o.status].map((s) => (
                    <option key={s} value={s} disabled={needsPaidFirst(o, s)}>
                      {statusLabel(s)}{needsPaidFirst(o, s) ? ` (${t("mark Paid first")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────────────
export default function DashboardPage({ data }) {
  const s = data?.stats || {};

  const [allOrders, setAllOrders] = useState([]);
  const [allTodayOrders, setAllTodayOrders] = useState([]);
  const [invoiceMap, setInvoiceMap] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, invoicesRes] = await Promise.all([
        getAllOrders({ limit: 1000 }),
        getAllInvoices().catch(() => ({ data: { invoices: [] } })),
      ]);
      const full = ordersRes.data.orders || [];
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

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const handleStatusChange = async (id, st) => {
    try {
      await updateOrderStatus(id, st);
      toast.success(`${t("Order")} → ${statusLabel(st)}`);
      setAllOrders((p) => p.map((o) => (o._id === id ? { ...o, status: st } : o)));
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

  // ── Stats — all real aggregates, canonical enum values ─────────────────────
  const paidOrders = allOrders.filter((o) => o.paymentStatus === "PAID");
  const dueOrders = allOrders.filter((o) => o.paymentStatus === "PENDING_VERIFICATION");
  const cashPaid = allOrders.filter((o) => o.paymentMethod === "Cash" && o.paymentStatus === "PAID");
  const onlinePaid = allOrders.filter((o) => o.paymentMethod === "Online" && o.paymentStatus === "PAID");

  const totalRev = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalDue = dueOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalCash = cashPaid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalOnline = onlinePaid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const avgOrder = paidOrders.length ? Math.round(totalRev / paidOrders.length) : 0;

  const activeFloorTables = allTodayOrders.filter(
    (o) => o.orderType === "DINE_IN" && o.tableNo && !ACTIVE_EXCLUDE.includes(o.status),
  ).length;
  const pendingInv = Object.values(invoiceMap).filter(
    (i) => i.invoiceStatus?.toLowerCase() === "pending",
  ).length;

  const paidToday = allTodayOrders.filter((o) => o.paymentStatus === "PAID");
  const todayRev = paidToday.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const weeklyRevenue = (data?.weeklyRevenue || []).map((d) => Number(d.revenue || 0));
  const weeklyRevenuePoints = (data?.weeklyRevenue || []).map((d) => ({
    label: d._id ? fmtDate(d._id, { weekday: "short" }) : "",
    value: Number(d.revenue || 0),
  }));

  // ── chart-ready aggregates — same real orders, reshaped per chart's job ────
  const statusRows = ALL_STATUSES.map((st) => ({
    label: statusLabel(st),
    value: allTodayOrders.filter((o) => o.status === st).length,
    color: KIND_INK[statusKind(st)],
  }));

  const orderTypeSegments = ["DINE_IN", "TAKEAWAY", "ONLINE"].map((ty, i) => ({
    label: typeLabel(ty),
    value: allTodayOrders.filter((o) => o.orderType === ty).length,
    color: CAT_COLORS[i],
  }));

  const cashPaidToday = allTodayOrders.filter((o) => o.paymentMethod === "Cash" && o.paymentStatus === "PAID");
  const onlinePaidToday = allTodayOrders.filter((o) => o.paymentMethod === "Online" && o.paymentStatus === "PAID");
  const paymentSegmentsToday = [
    { label: t("Cash"), value: cashPaidToday.reduce((s2, o) => s2 + Number(o.total || 0), 0), color: CAT_COLORS[3] },
    { label: t("Online"), value: onlinePaidToday.reduce((s2, o) => s2 + Number(o.total || 0), 0), color: CAT_COLORS[0] },
  ];

  const today = fmtDate(new Date(), {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const restaurantName = data?.profile?.restaurantName || "Ad's Cafe";

  const STAT_BOXES = [
    {
      icon: "💰", label: t("Total collected"), value: `₹${fmt(totalRev)}`, grad: true,
      sub: tn(paidOrders.length, "{n} paid order", "{n} paid orders"),
      spark: <Sparkline values={weeklyRevenue} stroke="var(--violet)" />,
    },
    { icon: "📦", label: t("Total orders"), value: fmt(allOrders.length), colorIdx: 1, sub: t("{n} today", { n: allTodayOrders.length }) },
    { icon: "🧾", label: t("Collected today"), value: `₹${fmt(todayRev)}`, colorIdx: 1, sub: t("{n} paid today", { n: paidToday.length }) },
    { icon: "🪑", label: t("Active tables"), value: fmt(activeFloorTables), colorIdx: 2, sub: t("On the floor now") },
    { icon: "✅", label: t("Paid orders"), value: fmt(paidOrders.length), colorIdx: 1, sub: t("₹{amount} collected", { amount: fmt(totalRev) }) },
    { icon: "🔴", label: t("Payment due"), value: fmt(dueOrders.length), color: "var(--stop-ink)", sub: t("₹{amount} outstanding", { amount: fmt(totalDue) }) },
    { icon: "💵", label: t("Cash collected"), value: `₹${fmt(totalCash)}`, colorIdx: 3, sub: tn(cashPaid.length, "{n} order", "{n} orders") },
    { icon: "📱", label: t("Online collected"), value: `₹${fmt(totalOnline)}`, colorIdx: 0, sub: tn(onlinePaid.length, "{n} order", "{n} orders") },
    { icon: "📊", label: t("Average order"), value: `₹${fmt(avgOrder)}`, colorIdx: 0, sub: t("Across paid orders") },
    { icon: "👥", label: t("Registered users"), value: fmt(s.totalUsers || 0), colorIdx: 2, sub: t("Guests included") },
    { icon: "🍽️", label: t("Menu items"), value: fmt(s.totalItems || 0), colorIdx: 3, sub: t("Available") },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.025em", color: "var(--text-1)", margin: 0 }}>
            {t("Dashboard")}
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>{today}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {pendingInv > 0 && (
            <span className="dash-blink zc-tag stop">
              <i />{tn(pendingInv, "{n} invoice pending", "{n} invoices pending")}
            </span>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--card-2)", border: "1px solid var(--edge)",
            borderRadius: 20, padding: "7px 14px",
          }}>
            <span style={{ fontSize: 15 }}>🏪</span>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>{t("Restaurant:")}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{restaurantName}</span>
          </div>
          <span className="zc-live-dot"><i />{t("Live")}</span>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 12, marginBottom: 22,
      }}>
        {STAT_BOXES.map((b, i) => <StatCard key={i} {...b} />)}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 60, color: "var(--text-3)" }}>
          <div className="zc-spin" />
          {t("Loading…")}
        </div>
      ) : (
        <>
        {/* Charts — each form picked for the job its data does */}
        <div className="zc-card" style={{ padding: 20, marginBottom: 16 }}>
          <SectionLabel>{t("Revenue trend — last 7 days")}</SectionLabel>
          <TrendChart points={weeklyRevenuePoints} color="var(--violet)" />
        </div>

        <div className="dash-charts-row" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div className="zc-card" style={{ padding: 20 }}>
            <SectionLabel>{t("Orders by status — today")}</SectionLabel>
            <RankedBars rows={statusRows} />
          </div>
          <div className="zc-card" style={{ padding: 20 }}>
            <SectionLabel>{t("Order type — today")}</SectionLabel>
            <SegmentedBar segments={orderTypeSegments} />
          </div>
          <div className="zc-card" style={{ padding: 20 }}>
            <SectionLabel>{t("Table occupancy")}</SectionLabel>
            <Meter value={activeFloorTables} max={s.totalTables || activeFloorTables} label={t("Tables on the floor")} sub={t("Active dine-in orders vs total tables")} />
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--edge)" }}>
              <SectionLabel style={{ marginBottom: 10 }}>{t("Payment method — today")}</SectionLabel>
              <SegmentedBar segments={paymentSegmentsToday} />
            </div>
          </div>
        </div>

        <div className="dash-cols">
          {/* LEFT */}
          <div className="zc-card" style={{ padding: 20 }}>
            <SectionLabel>{t("Orders by status — today (detail)")}</SectionLabel>
            <StatusSummary orders={allTodayOrders} />
            <SectionLabel>{t("Live table map")}</SectionLabel>
            <TableMap
              orders={allTodayOrders}
              invoiceMap={invoiceMap}
              onStatusChange={handleStatusChange}
              onInvoiceStatusChange={handleInvoiceChange}
            />
          </div>

          {/* RIGHT */}
          <div className="zc-card" style={{ padding: 20, maxHeight: "80vh", overflowY: "auto" }}>
            <SectionLabel>{t("Recent orders — today (active only)")}</SectionLabel>
            <OrderList orders={allTodayOrders} onStatusChange={handleStatusChange} />
          </div>
        </div>
        </>
      )}
    </div>
  );
}
