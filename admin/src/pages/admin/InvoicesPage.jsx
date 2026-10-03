// src/pages/admin/InvoicesPage.jsx — Admin → Operations → Invoices
// ─────────────────────────────────────────────────────────────────────────────
// Three views over real orders (an invoice = a billable order: COMPLETED or
// PAID, the rule this page has always used):
//   All invoices   period + status filters, Billed = Received + To collect +
//                  Check UPI, rows grouped by day, bill drawer, Collect
//   Customer dues  every unpaid bill across all dates, bulk "mark paid"
//   Close the day  (header button) today's totals, cash count, open items
//                  incl. orders not billed yet, WhatsApp summary
// Header "Your accountant" menu (invoices/AccountantMenu.jsx) makes the CA /
// bank reports (Excel + PDF) and the owner summary.
// Amounts are the order's stored subtotal / discount / serviceCharge / tax /
// total — never re-priced here. Payments go through the existing
// PATCH /admin/orders/:id/payment; printing through the existing print service.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { getAllOrders, updateOrderPayment, printOrderBill, getRestaurantProfile } from "../../services/adminService.js";
import { PageHeader, Loader, EmptyState } from "./shared/index.js";
import ErrorState from "./shared/ErrorState.jsx";
import InvoiceDrawer, { StateBadge } from "./invoices/InvoiceDrawer.jsx";
import CollectModal from "./invoices/CollectModal.jsx";
import DuesView from "./invoices/DuesView.jsx";
import CloseDayView from "./invoices/CloseDayView.jsx";
import {
  isInvoice, isVoid, isNotBilledYet, billState, custName, custPhone, money, totalsOf, groupByDay, daysOld,
  periodRange, ymd, billText, waLink, tableLabel,
} from "./invoices/model.js";
import AccountantMenu from "./invoices/AccountantMenu.jsx";
import { t, tn, N_, fmtNum, fmtDate, fmtTime } from "../../i18n/core.js";
import "./invoices/invoices.css";

const TABS = [
  { key: "bills", label: N_("All invoices") },
  { key: "dues", label: N_("Customer dues") },
];
const PERIODS = [
  { key: "today", label: N_("Today") },
  { key: "yesterday", label: N_("Yesterday") },
  { key: "week", label: N_("This week") },
  { key: "month", label: N_("This month") },
  { key: "custom", label: N_("Dates") },
];
const STATUS_FILTERS = [
  { key: "all", label: N_("All") },
  { key: "unpaid", label: N_("Unpaid") },
  { key: "checkUpi", label: N_("Check UPI") },
  { key: "paid", label: N_("Paid") },
  { key: "cancelled", label: N_("Cancelled") },
];
const TYPE_OPTIONS = [
  { key: "all", label: N_("All types") },
  { key: "DINE_IN", label: N_("Dine-in") },
  { key: "TAKEAWAY", label: N_("Takeaway") },
  { key: "ONLINE", label: N_("Online") },
];
const PAGE_ROWS = 60; // rows rendered before "Show more" (all rows are already loaded for the period)
const initials = (n) => n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

export default function InvoicesPage() {
  const [tab, setTab] = useState("bills");
  const [period, setPeriod] = useState("week");
  const [custom, setCustom] = useState(() => ({ from: ymd(new Date()), to: ymd(new Date()) }));
  const [statusF, setStatusF] = useState("all");
  const [typeF, setTypeF] = useState("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_ROWS);

  const [orders, setOrders] = useState(null);       // the period's orders (All invoices)
  const [error, setError] = useState(false);
  const [dues, setDues] = useState(null);           // every unpaid order (Customer dues)
  const [duesError, setDuesError] = useState(false);
  const [today, setToday] = useState(null);         // today's orders (Close the day)
  const [todayError, setTodayError] = useState(false);
  const [profile, setProfile] = useState(null);

  const [openId, setOpenId] = useState(null);
  const [collect, setCollect] = useState(null);     // { o, mode }
  const [busyId, setBusyId] = useState(null);

  // Server-side date range — only the period's orders are fetched, not the
  // whole order history (GET /admin/orders?from&to).
  const range = useMemo(() => {
    if (period !== "custom") return periodRange(period);
    const from = new Date(`${custom.from}T00:00:00`), to = new Date(`${custom.to}T23:59:59.999`);
    return { from, to: to < from ? new Date(`${custom.from}T23:59:59.999`) : to };
  }, [period, custom]);

  const loadPeriod = useCallback(() => {
    setError(false);
    getAllOrders({ from: range.from.toISOString(), to: range.to.toISOString(), limit: 5000 })
      .then((r) => setOrders(r.data?.orders || []))
      .catch(() => setError(true));
  }, [range]);
  const loadDues = useCallback(() => {
    setDuesError(false);
    getAllOrders({ paymentStatus: "PENDING_VERIFICATION", limit: 5000 })
      .then((r) => setDues((r.data?.orders || []).filter(isInvoice)))
      .catch(() => setDuesError(true));
  }, []);
  const loadToday = useCallback(() => {
    setTodayError(false);
    const { from, to } = periodRange("today");
    getAllOrders({ from: from.toISOString(), to: to.toISOString(), limit: 5000 })
      .then((r) => setToday(r.data?.orders || []))
      .catch(() => setTodayError(true));
  }, []);

  useEffect(() => { setOrders(null); setShown(PAGE_ROWS); loadPeriod(); }, [loadPeriod]);
  useEffect(() => { if (tab === "dues" && dues === null) loadDues(); }, [tab, dues, loadDues]);
  const openCloseDay = () => { setToday(null); loadToday(); setTab("close"); };
  useEffect(() => {
    getRestaurantProfile().then((r) => setProfile(r.data?.data || r.data || null)).catch(() => {});
    // The tab badge needs the dues count even before the tab is opened.
    loadDues();
  }, [loadDues]);

  // Apply a confirmed payment change to every list that holds this order.
  const patchEverywhere = (id, patch) => {
    const apply = (list) => (list ? list.map((o) => (o._id === id ? { ...o, ...patch } : o)) : list);
    setOrders(apply); setToday(apply);
    setDues((list) => (list ? apply(list).filter((o) => o.paymentStatus !== "PAID") : list));
  };

  const handlePaymentChange = async (id, data) => {
    setBusyId(id);
    try {
      await updateOrderPayment(id, data);
      patchEverywhere(id, data);
      if (data.paymentStatus === "PENDING_VERIFICATION") loadDues();
      toast.success(t("Payment updated ✓"));
    } catch (e) {
      toast.error(e?.response?.data?.message || t("Update failed"));
      throw e;
    } finally { setBusyId(null); }
  };
  const recordPayment = (o, method) => handlePaymentChange(o._id, { paymentStatus: "PAID", paymentMethod: method });
  const handlePrint = async (o) => {
    try { await printOrderBill(o._id); toast.success(t("Bill sent to printer ✓")); }
    catch (e) { toast.error(e?.response?.data?.message || t("Printer not running")); }
  };

  // ── All invoices: period set → status / type / search ─────────────────────
  const periodBills = useMemo(() => (orders || []).filter((o) => isInvoice(o) || isVoid(o)), [orders]);
  const typed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodBills.filter((o) => {
      if (typeF !== "all" && o.orderType !== typeF) return false;
      if (q && !`${o.orderId || ""} ${custName(o)} ${custPhone(o)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [periodBills, typeF, search]);
  const counts = useMemo(() => {
    const c = { all: typed.length, unpaid: 0, checkUpi: 0, paid: 0, cancelled: 0 };
    typed.forEach((o) => { c[billState(o)] += 1; });
    return c;
  }, [typed]);
  const rows = useMemo(() => (statusF === "all" ? typed : typed.filter((o) => billState(o) === statusF)), [typed, statusF]);
  const totals = useMemo(() => totalsOf(typed), [typed]);
  const groups = useMemo(() => groupByDay(rows.slice(0, shown)), [rows, shown]);
  const dayTotals = useMemo(() => {
    const map = {};
    for (const g of groupByDay(typed)) map[g.key] = g.totals;
    return map;
  }, [typed]);

  const allOpen = [...(orders || []), ...(dues || []), ...(today || [])];
  const openBill = openId ? allOpen.find((o) => o._id === openId) || null : null;
  const restaurantName = profile?.restaurantName || "";
  const periodText = period === "custom"
    ? `${fmtDate(range.from, { day: "2-digit", month: "2-digit", year: "numeric" })} – ${fmtDate(range.to, { day: "2-digit", month: "2-digit", year: "numeric" })}`
    : `${fmtDate(range.from, { day: "numeric", month: "short" })}${ymd(range.from) !== ymd(range.to) ? ` – ${fmtDate(range.to, { day: "numeric", month: "short" })}` : ""}`;

  // Today's orders for Close the day: billed/cancelled bills + not billed yet.
  const todayBills = useMemo(() => (today ? today.filter((o) => isInvoice(o) || isVoid(o)) : null), [today]);
  const todayNotBilled = useMemo(() => (today ? today.filter(isNotBilledYet) : []), [today]);
  const openDues = useMemo(() => (dues || []).filter((o) => ["unpaid", "checkUpi"].includes(billState(o))), [dues]);
  const duesTotal = openDues.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const headerSub = tab === "bills"
    ? `${tn(totals.count, "{n} invoice", "{n} invoices")} · ${periodText}`
    : tab === "dues"
      ? (dues === null ? t("Loading…") : `${tn(openDues.length, "{n} unpaid bill", "{n} unpaid bills")} · ${money(duesTotal)} ${t("to collect")}`)
      : `${t("Close the day")} · ${fmtDate(new Date(), { weekday: "long", day: "numeric", month: "short" })}`;

  const rowActions = (o) => {
    const st = billState(o);
    if (st === "unpaid") return <button type="button" className="zc-btn sm pri" onClick={() => setCollect({ o })}>{t("Collect {amount}", { amount: money(o.total) })}</button>;
    if (st === "checkUpi") return <button type="button" className="zc-btn sm" onClick={() => setCollect({ o, mode: "Online" })}>{t("Check {amount}", { amount: money(o.total) })}</button>;
    if (st === "paid") return (
      <>
        <button type="button" className="zc-btn sm ghost" title={t("Print bill")} onClick={() => handlePrint(o)}>🖨️ {t("Print")}</button>
        <a className="zc-btn sm ghost" href={waLink(custPhone(o), billText(o, restaurantName))} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>WhatsApp</a>
      </>
    );
    return null;
  };

  return (
    <div className="inv">
      <PageHeader
        title={t("Invoices")}
        sub={headerSub}
        right={
          <div className="inv-hdr-acts">
            <AccountantMenu orders={orders} range={range} periods={PERIODS} period={period} setPeriod={setPeriod} dues={dues} profile={profile} />
            <button type="button" className={`zc-btn${tab === "close" ? "" : " pri"}`} aria-pressed={tab === "close"} onClick={openCloseDay}>
              {tab === "close" ? `↻ ${t("Refresh day")}` : `✓ ${t("Close the day")}`}
            </button>
          </div>
        }
      />

      <div className="zc-subnav" role="tablist">
        {TABS.map((tb) => (
          <button type="button" role="tab" key={tb.key} aria-selected={tab === tb.key} className={tab === tb.key ? "on" : ""} onClick={() => setTab(tb.key)}>
            {t(tb.label)}
            {tb.key === "dues" && dues?.length > 0 && <span className="inv-tabn">{fmtNum(dues.length)}</span>}
          </button>
        ))}
      </div>

      {tab === "bills" && (
        <>
          <div className="inv-fbar">
            <input className="zc-input search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE_ROWS); }}
              placeholder={t("Search invoice no., name or phone")} aria-label={t("Search invoices")} />
            <div className="zc-seg" role="group" aria-label={t("Period")}>
              {PERIODS.map((p) => (
                <button type="button" key={p.key} className={period === p.key ? "on" : ""} onClick={() => setPeriod(p.key)}>{t(p.label)}</button>
              ))}
            </div>
            {period === "custom" && (
              <>
                <input type="date" className="zc-input" value={custom.from} max={ymd(new Date())} aria-label={t("From date")}
                  onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c.to < e.target.value ? e.target.value : c.to }))} />
                <span className="inv-hint">{t("to")}</span>
                <input type="date" className="zc-input" value={custom.to} min={custom.from} max={ymd(new Date())} aria-label={t("To date")}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </>
            )}
          </div>
          <div className="inv-fbar">
            <div className="zc-seg" role="group" aria-label={t("Payment status filter")}>
              {STATUS_FILTERS.map((s) => (
                <button type="button" key={s.key} className={statusF === s.key ? "on" : ""} onClick={() => { setStatusF(s.key); setShown(PAGE_ROWS); }}>
                  {t(s.label)}<span className="inv-seg-n">{fmtNum(counts[s.key])}</span>
                </button>
              ))}
            </div>
            <select className="zc-select" value={typeF} onChange={(e) => setTypeF(e.target.value)} aria-label={t("Order type filter")}>
              {TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{t(o.label)}</option>)}
            </select>
          </div>

          <div className="zc-card inv-strip">
            <div><div className="k">{t("Billed")}</div><div className="v tnum">{money(totals.billed)}</div><div className="d">{tn(totals.count, "{n} invoice", "{n} invoices")}</div></div>
            <div><div className="k">{t("Received")}</div><div className="v tnum" style={{ color: "var(--ready-ink)" }}>{money(totals.cash + totals.online)}</div><div className="d">{t("Cash")} {money(totals.cash)} · {t("Online")} {money(totals.online)}</div></div>
            <div><div className="k">{t("To collect")}</div><div className="v tnum" style={totals.toCollect ? { color: "var(--wait-ink)" } : undefined}>{money(totals.toCollect)}</div><div className="d">{tn(totals.toCollectN, "{n} invoice", "{n} invoices")}</div></div>
            <div><div className="k">{t("Check UPI")}</div><div className="v tnum" style={totals.checkUpi ? { color: "var(--accent-ink)" } : undefined}>{money(totals.checkUpi)}</div><div className="d">{tn(totals.checkUpiN, "{n} invoice", "{n} invoices")}</div></div>
            <div><div className="k">{t("Discounts & cancelled")}</div><div className="v tnum">{money(totals.discount + totals.cancelled)}</div><div className="d">{t("Discount")} {money(totals.discount)} · {t("Cancelled")} {money(totals.cancelled)}</div></div>
            <div className="inv-eq">
              {t("It adds up:")} <b>{t("Billed")} {money(totals.billed)}</b> = {t("Received")} <b>{money(totals.cash + totals.online)}</b> + {t("To collect")} <b>{money(totals.toCollect)}</b> + {t("Check UPI")} <b>{money(totals.checkUpi)}</b>
            </div>
          </div>

          <div className="zc-card">
            {error ? (
              <ErrorState title={t("Could not load invoices")} sub={t("The server did not respond. Check that the backend is running, then try again.")} onRetry={loadPeriod} />
            ) : orders === null ? (
              <div style={{ padding: "16px 18px" }}><Loader rows={8} /></div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={periodBills.length === 0 ? t("No invoices in this period") : t("No invoices match")}
                sub={periodBills.length === 0 ? t("Invoices appear here once an order is completed or paid.") : t("Nothing matches these filters. Try clearing them.")}
                action={(search || statusF !== "all" || typeF !== "all")
                  ? <button type="button" className="zc-btn" onClick={() => { setSearch(""); setStatusF("all"); setTypeF("all"); }}>{t("Clear filters")}</button>
                  : null}
              />
            ) : (
              <>
                <div className="inv-tablewrap">
                  <table className="zc-ledger">
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>{t("Invoice no.")}</th>
                        <th style={{ width: 80 }}>{t("Time")}</th>
                        <th>{t("Customer")}</th>
                        <th style={{ width: 90 }}>{t("Table")}</th>
                        <th className="num" style={{ width: 110 }}>{t("Amount")}</th>
                        <th style={{ width: 150 }}>{t("Status")}</th>
                        <th style={{ width: 200 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => {
                        const dt = dayTotals[g.key] || g.totals;
                        return [
                          <tr key={`d-${g.key}`} className="inv-day">
                            <td colSpan={7}>
                              <b>{fmtDate(g.date, { weekday: "long", day: "numeric", month: "short" })}</b>
                              {tn(dt.count, "{n} invoice", "{n} invoices")} · {money(dt.billed)} {t("billed")} · {money(dt.cash + dt.online)} {t("received")}
                              {dt.toCollect > 0 && <span style={{ color: "var(--wait-ink)" }}> · {t("To collect")} {money(dt.toCollect)}</span>}
                            </td>
                          </tr>,
                          ...g.rows.map((o) => {
                            const st = billState(o);
                            const name = custName(o);
                            const age = daysOld(o.createdAt);
                            return (
                              <tr key={o._id} className="inv-row" onClick={() => setOpenId(o._id)}>
                                <td><span className="inv-no">{o.orderId}</span></td>
                                <td className="tnum" style={{ color: "var(--text-2)" }}>{fmtTime(o.createdAt)}</td>
                                <td>
                                  <div className="inv-who">
                                    <span className={`inv-av${name ? "" : " g"}`}>{name ? initials(name) : "G"}</span>
                                    <div style={{ minWidth: 0 }}>
                                      <b>{name || t("Walk-in guest")}</b>
                                      {custPhone(o) && <small>+91 {custPhone(o)}</small>}
                                    </div>
                                  </div>
                                </td>
                                <td><span className="zc-tag vio sq">{tableLabel(o)}</span></td>
                                <td className="num">
                                  <span className={`inv-amt${st === "cancelled" ? " void" : ""}`}>{money(o.total)}</span>
                                  {o.discount > 0 && <div className="inv-sub">−{money(o.discount)} {t("discount")}</div>}
                                </td>
                                <td>
                                  <StateBadge o={o} />
                                  {(st === "unpaid" || st === "checkUpi") && age > 0 && <span className="inv-age">{tn(age, "{n} day old", "{n} days old")}</span>}
                                </td>
                                <td onClick={(e) => e.stopPropagation()}><div className="inv-acts">{rowActions(o)}</div></td>
                              </tr>
                            );
                          }),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="inv-cards">
                  {groups.map((g) => {
                    const dt = dayTotals[g.key] || g.totals;
                    return (
                      <div key={g.key}>
                        <div className="inv-cday"><b>{fmtDate(g.date, { weekday: "short", day: "numeric", month: "short" })}</b>{money(dt.billed)} {t("billed")} · {money(dt.cash + dt.online)} {t("received")}</div>
                        {g.rows.map((o) => {
                          const st = billState(o);
                          return (
                            <div key={o._id} className="inv-ocard" onClick={() => setOpenId(o._id)}>
                              <div className="top">
                                <div style={{ minWidth: 0 }}>
                                  <div className="inv-no">{o.orderId}</div>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)", marginTop: 2 }}>{custName(o) || t("Walk-in guest")}</div>
                                  <div className="inv-hint">{fmtTime(o.createdAt)} · {tableLabel(o)}</div>
                                </div>
                                <div style={{ textAlign: "right", flex: "none" }}>
                                  <div className={`inv-amt${st === "cancelled" ? " void" : ""}`}>{money(o.total)}</div>
                                  {o.discount > 0 && <div className="inv-sub">−{money(o.discount)}</div>}
                                </div>
                              </div>
                              <div className="meta">
                                <StateBadge o={o} />
                                <div style={{ marginLeft: "auto" }} className="inv-acts" onClick={(e) => e.stopPropagation()}>{rowActions(o)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                <div className="inv-tfoot">
                  <span>{t("Showing {a} of {b} invoices in this period", { a: fmtNum(Math.min(shown, rows.length)), b: fmtNum(rows.length) })}</span>
                  {rows.length > shown && <button type="button" className="zc-btn sm" onClick={() => setShown((n) => n + PAGE_ROWS)}>{t("Show more")}</button>}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === "dues" && (
        <DuesView
          orders={dues} error={duesError} onRetry={loadDues} restaurantName={restaurantName}
          onOpen={(o) => setOpenId(o._id)}
          onCollect={(o, mode) => setCollect({ o, mode })}
          onMarkPaid={(o) => handlePaymentChange(o._id, { paymentStatus: "PAID" })}
        />
      )}

      {tab === "close" && (
        <CloseDayView
          orders={todayBills}
          notBilled={todayNotBilled}
          error={todayError} onRetry={loadToday}
          restaurantName={restaurantName} ownerPhone={profile?.phone}
          onOpen={(o) => setOpenId(o._id)}
        />
      )}

      {openBill && (
        <InvoiceDrawer
          o={openBill}
          restaurantName={restaurantName}
          busy={busyId === openBill._id}
          onClose={() => setOpenId(null)}
          onCollect={(o) => setCollect({ o, mode: billState(o) === "checkUpi" ? "Online" : undefined })}
          onPrint={handlePrint}
          onPaymentChange={(id, data) => handlePaymentChange(id, data).catch(() => {})}
        />
      )}
      {collect && (
        <CollectModal o={collect.o} initialMode={collect.mode} onClose={() => setCollect(null)} onRecord={recordPayment} />
      )}
    </div>
  );
}
