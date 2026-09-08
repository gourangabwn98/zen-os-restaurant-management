// src/pages/admin/InvoicesPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Invoices" — the payment ledger for billable orders. Migrated to the
// shared design system (design-reference/zen-os-design-reference.html →
// "Invoices" screen) to match Dashboard / Billing.
//
// Data + business logic are UNCHANGED from the previous build:
//   • source        = getAllOrders()  (an "invoice" = a billable order)
//   • billable set  = order is COMPLETED  OR  payment is PAID
//   • payment edit  = PATCH /admin/orders/:id/payment  (canonical enums only)
//   • bulk dues     = CustomerDuesSummary (mark a customer's dues paid at once)
//   • print         = POST /admin/orders/:id/print-bill
// Every figure on screen is a live aggregate of that data — nothing invented.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { getAllOrders, updateOrderPayment, printOrderBill } from "../../services/adminService.js";
import PageHeader from "./shared/PageHeader.jsx";
import StatCard from "./shared/StatCard.jsx";
import Loader from "./shared/Loader.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import ErrorState from "./shared/ErrorState.jsx";
import { statusKind } from "./shared/statusKind.js";

// ── canonical vocabulary (restaurant-server/utils/orderStateMachine.js) ──────
const PAYMENT_STATUSES = ["PENDING_VERIFICATION", "PAID", "FAILED"];
const PAY_SEG = ["All", ...PAYMENT_STATUSES];
const TYPE_OPTIONS = ["All", "DINE_IN", "TAKEAWAY", "ONLINE"];
const PER_PAGE = 15;

// Quick date-range presets — set the SAME startDate/endDate the custom date
// inputs already use, so they compose with one filtering path instead of a
// second parallel one. Rolling windows ending today, matching the Today/
// Week/Month/Year convention already used on Insights (AnalyticsPage.jsx).
const RANGE_PRESETS = ["All", "Today", "Week", "Month", "Year"];
const RANGE_DAYS = { Today: 1, Week: 7, Month: 30, Year: 365 };
const localISODate = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const presetDates = (key) => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (RANGE_DAYS[key] - 1));
  return { start: localISODate(start), end: localISODate(end) };
};

const fmt = (n) => Math.round(n || 0).toLocaleString("en-IN");
const formatPayment = (s) =>
  ({ PENDING_VERIFICATION: "Pending invoice", PAID: "Paid", FAILED: "Failed" }[s] || s || "—");
const formatType = (s) =>
  ({ DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", ONLINE: "Online", All: "All types" }[s] || s || "—");

const AVATAR_GRADS = [
  "linear-gradient(140deg,#8B5CF6,#6D28D9)",
  "linear-gradient(140deg,#22D3EE,#0891B2)",
  "linear-gradient(140deg,#F0A93B,#D97706)",
  "linear-gradient(140deg,#35D08A,#059669)",
  "linear-gradient(140deg,#F2564D,#B91C1C)",
  "linear-gradient(140deg,#6366F1,#4338CA)",
];
const avc = (n) => AVATAR_GRADS[(n?.charCodeAt(0) || 0) % AVATAR_GRADS.length];
const ini = (n) => (!n || n === "Guest" ? "G" : n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2));
const custName = (o) => o.guestName || o.user?.name || "Guest";
const custPhone = (o) => o.guestPhone || o.user?.phone || null;

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("inv-styles")) {
  const s = document.createElement("style");
  s.id = "inv-styles";
  s.textContent = `
    .inv-idc { color: var(--text-2); font-weight: 600; font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .zc-ledger tbody tr.inv-hl td { background: linear-gradient(168deg, var(--violet-weak), transparent); border-color: var(--violet-mid); }
    .zc-ledger tbody tr.inv-click { cursor: pointer; }
    .inv-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .inv-who .av { width: 27px; height: 27px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 10.5px; font-weight: 700; color: #fff; }
    .inv-who b { font-weight: 600; display: block; line-height: 1.3; color: var(--text-1); }
    .inv-who em { font-style: normal; color: var(--text-3); font-size: 11px; display: block; line-height: 1.3; }
    .inv-filters { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .inv-cards { display: none; }
    @media (max-width: 860px) {
      .inv-ledger-wrap { display: none; }
      .inv-cards { display: block; }
    }
    .inv-ocard {
      border: 1px solid var(--edge); border-radius: var(--r-row);
      background: var(--grad-panel); padding: 12px 13px; margin-bottom: 8px; cursor: pointer;
      transition: border-color .12s ease;
    }
    .inv-ocard:hover { border-color: var(--edge-hi); }
    .inv-ocard.inv-hl { border-color: var(--stop-line); background: var(--stop-fill); }
    .inv-dues { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Customer-wise pending dues — bulk "mark paid" for one customer's open invoices
// (business feature preserved from the previous build; restyled to Zen OS)
// ═══════════════════════════════════════════════════════════════════════════════
function CustomerDuesSummary({ invoices, onPaymentChange }) {
  const [selected, setSelected] = useState({});
  const [busyName, setBusyName] = useState(null);

  const customers = useMemo(() => {
    const map = {};
    invoices.forEach((inv) => {
      const name = custName(inv);
      if (!map[name]) map[name] = { name, invoices: [], phone: custPhone(inv) };
      map[name].invoices.push(inv);
    });
    return Object.values(map)
      .map((c) => ({
        ...c,
        pending: c.invoices.filter(
          (i) => i.paymentStatus === "PENDING_VERIFICATION" || i.paymentStatus === "FAILED",
        ),
      }))
      .filter((c) => c.pending.length > 0)
      .map((c) => ({ ...c, pendingTotal: c.pending.reduce((s, i) => s + Number(i.total || 0), 0) }))
      .sort((a, b) => b.pendingTotal - a.pendingTotal);
  }, [invoices]);

  if (customers.length === 0) return null;

  const key = (name, id) => `${name}::${id}`;
  const toggle = (name, id) => setSelected((p) => ({ ...p, [key(name, id)]: !p[key(name, id)] }));
  const selectAll = (c, on) =>
    setSelected((p) => {
      const next = { ...p };
      c.pending.forEach((i) => (next[key(c.name, i._id)] = on));
      return next;
    });
  const chosen = (c) => c.pending.filter((i) => selected[key(c.name, i._id)]);

  const payChosen = async (c, list) => {
    const targets = list || chosen(c);
    if (!targets.length) return;
    setBusyName(c.name);
    try {
      await Promise.all(targets.map((i) => onPaymentChange(i._id, { paymentStatus: "PAID" })));
      selectAll(c, false);
      toast.success(`${targets.length} invoice${targets.length > 1 ? "s" : ""} marked paid`);
    } catch {
      toast.error("Some invoices could not be updated");
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-ink)", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>
        Customer-wise pending dues
      </div>
      <div className="inv-dues">
        {customers.map((c) => {
          const sel = chosen(c);
          const selTotal = sel.reduce((s, i) => s + Number(i.total || 0), 0);
          const busy = busyName === c.name;
          return (
            <div key={c.name} className="zc-panel" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>{c.name}</div>
                  {c.phone && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>+91 {c.phone}</div>}
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: "var(--stop-ink)" }}>₹{fmt(c.pendingTotal)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{c.pending.length} pending</div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--edge)", paddingTop: 10, marginBottom: 12 }}>
                {c.pending.map((inv) => {
                  const on = !!selected[key(c.name, inv._id)];
                  return (
                    <div
                      key={inv._id}
                      onClick={() => toggle(c.name, inv._id)}
                      role="checkbox"
                      aria-checked={on}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(c.name, inv._id))}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", cursor: "pointer",
                        borderRadius: 8, background: on ? "var(--violet-weak)" : "transparent", transition: "background .15s",
                      }}
                    >
                      <span style={{
                        width: 17, height: 17, borderRadius: 5, flexShrink: 0, display: "grid", placeItems: "center",
                        border: `1.5px solid ${on ? "var(--violet)" : "var(--edge-hi)"}`,
                        background: on ? "var(--violet)" : "transparent", color: "#fff", fontSize: 11, fontWeight: 700,
                      }}>{on ? "✓" : ""}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{inv.orderId}</span>
                          <span className="tnum" style={{ fontSize: 12, fontWeight: 700, color: on ? "var(--accent-ink)" : "var(--text-1)" }}>₹{Math.round(inv.total)}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inv.items?.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {sel.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 10 }}>
                  <button type="button" onClick={() => selectAll(c, false)} className="zc-btn ghost sm">Clear</button>
                  <span style={{ color: "var(--text-2)" }}>
                    {sel.length} selected · <b className="tnum" style={{ color: "var(--accent-ink)" }}>₹{fmt(selTotal)}</b>
                  </span>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={sel.length === 0 || busy}
                  onClick={() => payChosen(c)}
                  className="zc-btn pri" style={{ flex: 1, justifyContent: "center" }}
                >
                  {busy ? "Marking paid…" : `Mark paid · ₹${fmt(selTotal)}`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => payChosen(c, c.pending)}
                  className="zc-btn sm" style={{ justifyContent: "center", whiteSpace: "nowrap" }}
                >
                  All · ₹{fmt(c.pendingTotal)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Invoice detail modal — receipt + payment controls (was the expandable row)
// ═══════════════════════════════════════════════════════════════════════════════
function InvoiceDetailModal({ inv, busy, onClose, onPaymentChange, onPrint }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!inv) return null;
  const name = custName(inv);
  const phone = custPhone(inv);
  const subtotal = inv.subtotal ?? inv.items?.reduce((s, i) => s + i.price * i.qty, 0) ?? 0;
  const placedAt = inv.createdAt
    ? new Date(inv.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
  const summary = [
    ["Subtotal", subtotal],
    ...(inv.serviceCharge > 0 ? [["Service charge", inv.serviceCharge]] : []),
    ...(inv.tax > 0 ? [["GST", inv.tax]] : []),
    ...(inv.discount > 0 ? [["Discount", -inv.discount]] : []),
  ];
  const info = [
    ["Customer", name],
    ["Phone", phone ? `+91 ${phone}` : "—"],
    ["Type", formatType(inv.orderType)],
    ["Table", inv.tableNo ? `T${inv.tableNo}` : "—"],
  ];

  return (
    <div className="zc-scrim" onClick={onClose}>
      <div className="zc-modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t tnum">{inv.orderId}</div>
            <div className="s">placed {placedAt}</div>
          </div>
          <span className={`zc-tag ${statusKind(inv.paymentStatus)}`}><i />{formatPayment(inv.paymentStatus)}</span>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mb">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 18 }}>
            {info.map(([k, v]) => (
              <div key={k} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--card-2)", border: "1px solid var(--edge)" }}>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{k}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3, color: "var(--text-1)", wordBreak: "break-word" }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Receipt</div>
          <div style={{ borderRadius: 13, border: "1px solid var(--edge)", overflow: "hidden", marginBottom: 20 }}>
            {inv.items?.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", borderBottom: "1px solid var(--edge)", fontSize: 12.5 }}>
                <span className="zc-q">{item.qty}</span>
                <span style={{ flex: 1, color: "var(--text-1)" }}>{item.name}</span>
                <span className="tnum" style={{ fontWeight: 600, color: "var(--text-1)" }}>₹{item.price * item.qty}</span>
              </div>
            ))}
            <div style={{ padding: "12px 14px", display: "grid", gap: 6, fontSize: 12.5, background: "var(--card-2)" }}>
              {summary.map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-2)" }}>{k}</span>
                  <span className="tnum" style={{ color: "var(--text-1)" }}>{v < 0 ? `−₹${Math.abs(v)}` : `₹${v}`}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, paddingTop: 8, borderTop: "1px solid var(--edge)" }}>
                <span style={{ color: "var(--text-1)" }}>Total</span>
                <span className="tnum zc-grad-text">₹{Math.round(inv.total)}</span>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Payment status</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {PAYMENT_STATUSES.map((s) => {
              const active = inv.paymentStatus === s;
              const k = statusKind(s);
              return (
                <button
                  key={s} type="button" disabled={active || busy}
                  onClick={() => onPaymentChange(inv._id, { paymentStatus: s })}
                  className={`zc-tag ${k}`}
                  style={{
                    cursor: active || busy ? "default" : "pointer", font: "inherit",
                    opacity: active ? 1 : busy ? 0.4 : 0.6,
                  }}
                >
                  {active ? "✓ " : ""}{formatPayment(s)}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Payment method</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Cash", "Online"].map((m) => {
              const active = (inv.paymentMethod || "Cash") === m;
              return (
                <button
                  key={m} type="button" disabled={active || busy}
                  onClick={() => onPaymentChange(inv._id, { paymentMethod: m })}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: "var(--r-ctl)", fontSize: 12.5, fontWeight: 600, font: "inherit",
                    cursor: active || busy ? "default" : "pointer",
                    border: `2px solid ${active ? "var(--violet)" : "var(--edge)"}`,
                    background: active ? "var(--violet-weak)" : "var(--card-2)",
                    color: active ? "var(--accent-ink)" : "var(--text-2)",
                  }}
                >
                  {m === "Cash" ? "💵 Cash" : "📱 Online"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mf" style={{ flexWrap: "wrap" }}>
          <button type="button" className="zc-btn" onClick={() => onPrint(inv)}>🖨️ Print bill</button>
          {inv.paymentStatus !== "PAID" && (
            <button type="button" className="zc-btn good" disabled={busy}
              onClick={() => onPaymentChange(inv._id, { paymentStatus: "PAID" })}>
              {busy ? "Updating…" : "✓ Mark as paid"}
            </button>
          )}
          <button type="button" className="zc-btn pri" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
export default function InvoicesPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [search, setSearch] = useState("");
  const [payF, setPayF] = useState("All");
  const [typeF, setTypeF] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [quickRange, setQuickRange] = useState("All");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const applyQuickRange = (key) => {
    setQuickRange(key);
    setPage(1);
    if (key === "All") { setStartDate(""); setEndDate(""); return; }
    const { start, end } = presetDates(key);
    setStartDate(start); setEndDate(end);
  };
  // Editing a custom date directly supersedes whatever preset was active,
  // so the segmented control doesn't keep showing a now-stale selection.
  const editStartDate = (v) => { setStartDate(v); setQuickRange("All"); setPage(1); };
  const editEndDate = (v) => { setEndDate(v); setQuickRange("All"); setPage(1); };

  const load = useCallback(() => {
    getAllOrders({ limit: 5000 })
      .then((r) => { setOrders(r.data?.orders || []); setError(false); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Payment update — same endpoint / validation as the previous build & Billing.
  const handlePaymentChange = async (orderId, data) => {
    setBusyId(orderId);
    try {
      await updateOrderPayment(orderId, data);
      setOrders((prev) => prev.map((o) => (o._id === orderId ? { ...o, ...data } : o)));
      toast.success("Payment updated ✓");
    } catch (e) {
      toast.error(e?.response?.data?.message || "Update failed");
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const handlePrint = async (o) => {
    try {
      await printOrderBill(o._id);
      toast.success("Bill sent to printer ✓");
    } catch (e) {
      toast.error(e?.response?.data?.message || "Printer not running");
    }
  };

  // An "invoice" = a billable order: completed OR already paid (unchanged rule).
  const invoiceOrders = useMemo(
    () => orders.filter((o) => o.status === "COMPLETED" || o.paymentStatus === "PAID"),
    [orders],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoiceOrders.filter((o) => {
      if (payF !== "All" && o.paymentStatus !== payF) return false;
      if (typeF !== "All" && o.orderType !== typeF) return false;
      if (startDate || endDate) {
        const d = new Date(o.createdAt).toISOString().slice(0, 10);
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
      }
      if (q) {
        const hay = `${o.orderId || ""} ${custName(o)} ${custPhone(o) || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoiceOrders, search, payF, typeF, startDate, endDate]);

  // ── stats — live aggregates only ──────────────────────────────────────────
  const paid = invoiceOrders.filter((o) => o.paymentStatus === "PAID");
  const pendingVerif = invoiceOrders.filter((o) => o.paymentStatus === "PENDING_VERIFICATION");
  const failed = invoiceOrders.filter((o) => o.paymentStatus === "FAILED");
  const totalCollected = paid.reduce((s, o) => s + Number(o.total || 0), 0);
  const pendingTotal = pendingVerif.reduce((s, o) => s + Number(o.total || 0), 0);
  const failedTotal = failed.reduce((s, o) => s + Number(o.total || 0), 0);

  const hasFilters = search || payF !== "All" || typeF !== "All" || startDate || endDate;
  const clearFilters = () => {
    setSearch(""); setPayF("All"); setTypeF("All"); setStartDate(""); setEndDate(""); setQuickRange("All"); setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const pageList = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1] !== p - 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  const openInvoice = openId ? filtered.find((o) => o._id === openId) || invoiceOrders.find((o) => o._id === openId) || null : null;

  const STATS = [
    { label: "Collected", value: `₹${fmt(totalCollected)}`, grad: true, sub: `${paid.length} paid invoice${paid.length === 1 ? "" : "s"}` },
    { label: "Pending invoices", value: fmt(pendingVerif.length), color: "var(--stop-ink)", sub: `₹${fmt(pendingTotal)} unconfirmed` },
    { label: "Failed", value: fmt(failed.length), color: "var(--stop-ink)", sub: failed.length ? `₹${fmt(failedTotal)} · retry or void` : "None" },
    { label: "Total invoices", value: fmt(invoiceOrders.length), color: "var(--text-2)", sub: "Completed or paid" },
  ];

  const dateInputStyle = (v) => ({ width: "auto", color: v ? "var(--text-1)" : "var(--text-3)" });

  return (
    <div>
      <PageHeader
        title="Invoices"
        sub={`${invoiceOrders.length} invoice${invoiceOrders.length === 1 ? "" : "s"} · ₹${fmt(totalCollected)} collected`}
      />

      {/* stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        {STATS.map((b, i) => <StatCard key={i} {...b} />)}
      </div>

      {/* filters */}
      <div className="inv-filters">
        <input
          className="zc-input"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by order ID, customer or phone"
          aria-label="Search invoices"
          style={{ flex: 1, minWidth: 240 }}
        />
        <div className="zc-seg" role="tablist" aria-label="Payment status filter">
          {PAY_SEG.map((s) => (
            <button
              key={s} type="button" role="tab" aria-selected={payF === s}
              className={payF === s ? "on" : ""}
              onClick={() => { setPayF(s); setPage(1); }}
              title={s === "All" ? "All payments" : formatPayment(s)}
            >
              {{ All: "All", PENDING_VERIFICATION: "Pending", PAID: "Paid", FAILED: "Failed" }[s]}
            </button>
          ))}
        </div>
        <select
          className="zc-select" value={typeF} aria-label="Order type filter"
          onChange={(e) => { setTypeF(e.target.value); setPage(1); }}
          style={{ width: "auto" }}
        >
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{formatType(t)}</option>)}
        </select>
        <div className="zc-seg" role="tablist" aria-label="Date range preset">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r} type="button" role="tab" aria-selected={quickRange === r}
              className={quickRange === r ? "on" : ""}
              onClick={() => applyQuickRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <input type="date" className="zc-input" value={startDate} aria-label="From date"
          onChange={(e) => editStartDate(e.target.value)} style={dateInputStyle(startDate)} />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>to</span>
        <input type="date" className="zc-input" value={endDate} min={startDate || undefined} aria-label="To date"
          onChange={(e) => editEndDate(e.target.value)} style={dateInputStyle(endDate)} />
        <div style={{ flex: 1 }} />
        {hasFilters ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent-ink)" }}>{filtered.length}</b> of {invoiceOrders.length}
            </span>
            <button type="button" className="zc-btn sm" onClick={clearFilters}>Clear ✕</button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {pendingVerif.length} pending invoice{pendingVerif.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* bulk dues — only while filtering, matching the previous build */}
      {hasFilters && filtered.length > 0 && (
        <CustomerDuesSummary invoices={filtered} onPaymentChange={handlePaymentChange} />
      )}

      {/* list */}
      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">Invoices</span>
          <span className="s">{loading ? "loading…" : error ? "unavailable" : `${filtered.length} matching`}</span>
        </div>

        {loading ? (
          <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
        ) : error ? (
          <ErrorState title="Could not load invoices"
            sub="The server did not respond. Check that the backend is running, then try again."
            onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" />
              </svg>
            }
            title={invoiceOrders.length === 0 ? "No invoices yet" : "No invoices match"}
            sub={invoiceOrders.length === 0
              ? "Invoices appear here once an order is completed and billed. Start one from Billing."
              : "Nothing matches these filters. Try clearing them."}
            action={hasFilters ? <button type="button" className="zc-btn" onClick={clearFilters}>Clear filters</button> : null}
          />
        ) : (
          <>
            {/* desktop / tablet ledger */}
            <div className="inv-ledger-wrap" style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
              <table className="zc-ledger" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 108 }}>Invoice</th>
                    <th>Customer</th>
                    <th style={{ width: 64 }}>Table</th>
                    <th style={{ width: 84 }}>Method</th>
                    <th style={{ width: 176 }}>Payment</th>
                    <th className="num" style={{ width: 104 }}>Amount</th>
                    <th className="num" style={{ width: 78 }}>Time</th>
                    <th style={{ width: 108 }} />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((o) => {
                    const needsAction = o.paymentStatus === "PENDING_VERIFICATION";
                    const name = custName(o);
                    const phone = custPhone(o);
                    return (
                      <tr
                        key={o._id}
                        className={`inv-click${needsAction ? " inv-hl" : ""}`}
                        onClick={() => setOpenId(o._id)}
                      >
                        <td className="inv-idc">{o.orderId}</td>
                        <td>
                          <div className="inv-who">
                            <span className="av" style={{ background: avc(name) }}>{ini(name)}</span>
                            <div style={{ minWidth: 0 }}>
                              <b>{name}</b>
                              {phone && <em>+91 {phone}</em>}
                            </div>
                          </div>
                        </td>
                        <td>
                          {o.tableNo
                            ? <span className="zc-tag vio sq">T{o.tableNo}</span>
                            : <span style={{ color: "var(--text-3)" }}>—</span>}
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{o.paymentMethod || "Cash"}</td>
                        <td><span className={`zc-tag ${statusKind(o.paymentStatus)}`}><i />{formatPayment(o.paymentStatus)}</span></td>
                        <td className={`money${needsAction ? " neg" : ""}`}>₹{Math.round(o.total)}</td>
                        <td className="num" style={{ color: "var(--text-3)" }}>
                          {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          {needsAction ? (
                            <button type="button" className="zc-btn good sm" disabled={busyId === o._id}
                              onClick={() => handlePaymentChange(o._id, { paymentStatus: "PAID" }).catch(() => {})}>
                              {busyId === o._id ? "…" : "Mark paid"}
                            </button>
                          ) : (
                            <button type="button" className="zc-btn ghost sm" title="Print bill"
                              onClick={() => handlePrint(o)}>🖨️</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <div className="inv-cards" style={{ padding: "10px 12px 4px" }}>
              {paginated.map((o) => {
                const needsAction = o.paymentStatus === "PENDING_VERIFICATION";
                const name = custName(o);
                return (
                  <div key={o._id} className={`inv-ocard${needsAction ? " inv-hl" : ""}`} onClick={() => setOpenId(o._id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="tnum inv-idc">{o.orderId}</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-1)", marginTop: 2, fontWeight: 600 }}>{name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{o.paymentMethod || "Cash"}</div>
                      </div>
                      <div style={{ textAlign: "right", flex: "none" }}>
                        <div className="tnum" style={{ fontWeight: 700, fontSize: 14, color: needsAction ? "var(--stop-ink)" : "var(--text-1)" }}>₹{Math.round(o.total)}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>
                          {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                      {o.tableNo && <span className="zc-tag vio sq">T{o.tableNo}</span>}
                      <span className={`zc-tag ${statusKind(o.paymentStatus)}`}><i />{formatPayment(o.paymentStatus)}</span>
                      <div style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                        {needsAction ? (
                          <button type="button" className="zc-btn good sm" disabled={busyId === o._id}
                            onClick={() => handlePaymentChange(o._id, { paymentStatus: "PAID" }).catch(() => {})}>
                            {busyId === o._id ? "…" : "Mark paid"}
                          </button>
                        ) : (
                          <button type="button" className="zc-btn ghost sm" onClick={() => handlePrint(o)}>🖨️</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="zc-tfoot" style={{ padding: "14px 18px 6px" }}>
                <span>
                  Showing {(safePage - 1) * PER_PAGE + 1}–{Math.min(safePage * PER_PAGE, filtered.length)} of {filtered.length}
                </span>
                <div className="zc-pager">
                  <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">‹</button>
                  {pageList.map((p, i) =>
                    p === "…"
                      ? <span key={`g${i}`} className="gap">…</span>
                      : <button type="button" key={p} className={safePage === p ? "on" : ""} onClick={() => setPage(p)}>{p}</button>,
                  )}
                  <button type="button" disabled={safePage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {openInvoice && (
        <InvoiceDetailModal
          inv={openInvoice}
          busy={busyId === openInvoice._id}
          onClose={() => setOpenId(null)}
          onPaymentChange={(id, data) => handlePaymentChange(id, data).catch(() => {})}
          onPrint={handlePrint}
        />
      )}
    </div>
  );
}
