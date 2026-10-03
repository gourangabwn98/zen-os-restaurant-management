// src/pages/admin/invoices/AccountantMenu.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Invoices header → "Your accountant" (replaces the old Export button).
//   For your accountant (CA)
//     Sales register        Excel · every bill with items      (page period)
//     Day-by-day summary    PDF · one line per day             (page period)
//     Payments by method    Excel · cash vs UPI                (page period)
//     Dues list             PDF · who owes what, how old       (all open dues)
//   For the bank or a loan
//     Monthly sales statement  PDF · with your restaurant details (picked month)
//   Send to owner on WhatsApp or email
// Builders live in reports.js; nothing here changes an order.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getAllOrders } from "../../../services/adminService.js";
import { t, tn, fmtNum } from "../../../i18n/core.js";
import { ymd, waLink, billState } from "./model.js";
import { downloadBlob } from "./xlsx.js";
import {
  billsOf, salesRegisterXlsx, paymentsXlsx, printDaySummary, printDuesList, printMonthlyStatement,
  ownerSummaryText, periodLabel,
} from "./reports.js";

// Line icons in the sidebar's style (AdminLayout ICONS: 24 grid, 1.6 stroke).
const Svg = ({ size = 16, children }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
/** Ledger book with a ₹ — the "Your accountant" logo. */
const AccountantIcon = ({ size }) => (
  <Svg size={size}><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /><path d="M10 7h5M10 9.5h5M12.5 9.5c0 2-1.2 2.8-2.5 2.8l3.5 3.2" /></Svg>
);
const SheetIcon = () => <Svg><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M10 3v18" /></Svg>;
const DocIcon = () => <Svg><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></Svg>;
const DownIcon = () => <Svg size={14}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;

const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export default function AccountantMenu({ orders, range, periods, period, setPeriod, dues, profile }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const loading = orders === null;
  const nBills = loading ? 0 : billsOf(orders).length;
  const openDues = (dues || []).filter((o) => ["unpaid", "checkUpi"].includes(billState(o)));
  const fileStem = `${ymd(range.from)}-to-${ymd(range.to)}`;
  const name = profile?.restaurantName || "";

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e?.response?.data?.message || e.message || t("Could not make the report")); }
    finally { setBusy(null); }
  };
  const needBills = () => { if (!nBills) { toast.error(t("No bills in this period — pick another period")); return false; } return true; };

  const salesRegister = () => needBills() && run("sales", () => {
    downloadBlob(`sales-register-${fileStem}.xlsx`, salesRegisterXlsx(orders, range, profile));
    toast.success(t("Sales register downloaded"));
  });
  const daySummary = () => needBills() && run("days", () => printDaySummary(orders, range, profile));
  const payments = () => needBills() && run("pay", () => {
    downloadBlob(`payments-by-method-${fileStem}.xlsx`, paymentsXlsx(orders, range, profile));
    toast.success(t("Payments report downloaded"));
  });
  const duesList = () => {
    if (dues === null) return toast(t("Dues are still loading — try again in a moment"));
    run("dues", () => printDuesList(dues, profile));
  };
  const monthly = () => run("month", async () => {
    const [y, m] = month.split("-").map(Number);
    const from = new Date(y, m - 1, 1), to = new Date(y, m, 0, 23, 59, 59, 999);
    const { data } = await getAllOrders({ from: from.toISOString(), to: to.toISOString(), limit: 5000 });
    const list = data?.orders || [];
    if (!billsOf(list).length) { toast.error(t("No bills in that month")); return; }
    printMonthlyStatement(list, month, profile);
  });

  // Send to owner: the period's summary as text. wa.me / mailto can't carry
  // files, so on phones that can share files we also offer the two Excel files.
  const summary = loading ? "" : ownerSummaryText(orders, range, dues, profile);
  const subject = `${name ? `${name} — ` : ""}${t("Accounts summary")} ${periodLabel(range)}`;
  const mailHref = `mailto:${encodeURIComponent(profile?.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary.replace(/\*/g, ""))}`;
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function"
    && (() => { try { return navigator.canShare({ files: [new File(["x"], "x.xlsx", { type: "application/octet-stream" })] }); } catch { return false; } })();
  const shareFiles = () => needBills() && run("share", async () => {
    const files = [
      new File([salesRegisterXlsx(orders, range, profile)], `sales-register-${fileStem}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      new File([paymentsXlsx(orders, range, profile)], `payments-by-method-${fileStem}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    ];
    try { await navigator.share({ title: subject, text: summary, files }); }
    catch (e) { if (e?.name !== "AbortError") throw e; }
  });

  const Item = ({ k, title, sub, onClick, disabled }) => (
    <button type="button" className="inv-acc-item" role="menuitem" disabled={disabled || busy === k} onClick={onClick}>
      <span className={`ic${sub.startsWith("Excel") ? " xl" : ""}`}>{sub.startsWith("Excel") ? <SheetIcon /> : <DocIcon />}</span>
      <span className="tx"><b>{title}</b><small>{busy === k ? t("Preparing…") : sub}</small></span>
      <span className="go"><DownIcon /></span>
    </button>
  );

  return (
    <div className="inv-acc" ref={ref}>
      <button type="button" className="zc-btn inv-acc-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <AccountantIcon /> {t("Your accountant")} <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div className="inv-acc-pop" role="menu" aria-label={t("Your accountant")}>
          <div className="inv-acc-period">
            <span>{t("Period")}: <b>{periodLabel(range)}</b> · {loading ? t("Loading…") : tn(nBills, "{n} bill", "{n} bills")}</span>
            <div className="zc-seg" role="group" aria-label={t("Period")}>
              {periods.filter((p) => p.key !== "custom").map((p) => (
                <button key={p.key} type="button" className={period === p.key ? "on" : ""} onClick={() => setPeriod(p.key)}>{t(p.label)}</button>
              ))}
            </div>
          </div>

          <div className="inv-acc-h">{t("For your accountant (CA)")}</div>
          <Item k="sales" title={t("Sales register")} sub={`Excel · ${t("every bill with items")}`} onClick={salesRegister} disabled={loading} />
          <Item k="days" title={t("Day-by-day summary")} sub={`PDF · ${t("one line per day")}`} onClick={daySummary} disabled={loading} />
          <Item k="pay" title={t("Payments by method")} sub={`Excel · ${t("cash vs UPI")}`} onClick={payments} disabled={loading} />
          <Item k="dues" title={t("Dues list")} sub={`PDF · ${t("who owes what, how old")}${dues ? ` · ${fmtNum(openDues.length)}` : ""}`} onClick={duesList} />

          <div className="inv-acc-h">{t("For the bank or a loan")}</div>
          <div className="inv-acc-row">
            <Item k="month" title={t("Monthly sales statement")} sub={`PDF · ${t("with your restaurant details")}`} onClick={monthly} />
            <input type="month" className="zc-input" value={month} max={monthKeyOf(new Date())} aria-label={t("Month for the statement")}
              onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          {!profile?.gstNumber && !profile?.address && (
            <div className="inv-hint" style={{ padding: "0 10px 4px" }}>{t("Tip: add your address and GSTIN in Profile so they print on the statement.")}</div>
          )}

          <div className="inv-acc-h">{t("Send to owner on WhatsApp or email")}</div>
          <div className="inv-acc-send">
            <a className={`zc-btn sm${loading ? " disabled" : ""}`} href={loading ? undefined : waLink(profile?.phone, summary)} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: "none" }} aria-disabled={loading}>WhatsApp</a>
            <a className={`zc-btn sm${loading ? " disabled" : ""}`} href={loading ? undefined : mailHref} style={{ textDecoration: "none" }} aria-disabled={loading}>{t("Email")}</a>
            {canShareFiles && (
              <button type="button" className="zc-btn sm" disabled={loading || busy === "share"} onClick={shareFiles}>{t("Share Excel files")}</button>
            )}
          </div>
          <div className="inv-hint" style={{ padding: "2px 10px 6px" }}>
            {profile?.phone || profile?.email
              ? t("Sends this period's summary to {to}. Attach the downloaded files if your accountant needs them.", { to: [profile?.phone && `+91 ${profile.phone}`, profile?.email].filter(Boolean).join(" / ") })
              : t("No owner phone or email in Profile — you'll pick the contact yourself.")}
          </div>
        </div>
      )}
    </div>
  );
}
