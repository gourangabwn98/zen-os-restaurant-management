// src/pages/admin/invoices/CloseDayView.jsx
// End-of-day check for today's bills: the day's real totals, a cash count
// against the cash the system says was received, anything still open, and a
// WhatsApp summary. The count is a counter aid kept in this browser only — it
// is not saved to the server and changes no bill.
import { useEffect, useState } from "react";
import { Loader } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { t, fmtNum, fmtDate, fmtTime } from "../../../i18n/core.js";
import { billState, custName, money, totalsOf, waLink, ymd } from "./model.js";

const FACES = [500, 200, 100, 50, 20, 10];
const storeKey = () => `inv-cashcount-${ymd(new Date())}`;
const readCount = () => {
  try { return JSON.parse(localStorage.getItem(storeKey())) || null; } catch { return null; }
};

export default function CloseDayView({ orders, error, onRetry, restaurantName, ownerPhone, onOpen }) {
  const [count, setCount] = useState(() => readCount() || { opening: 0, coins: 0, ...Object.fromEntries(FACES.map((f) => [f, 0])) });
  useEffect(() => { try { localStorage.setItem(storeKey(), JSON.stringify(count)); } catch { /* storage disabled */ } }, [count]);

  if (error) return <div className="zc-card"><ErrorState onRetry={onRetry} /></div>;
  if (!orders) return <div className="zc-card inv-panel"><Loader rows={6} /></div>;

  const o = totalsOf(orders);
  const counted = FACES.reduce((s, f) => s + f * (count[f] || 0), 0) + (Number(count.coins) || 0);
  const expected = (Number(count.opening) || 0) + o.cash;
  const diff = counted - expected;
  const step = (face, d) => setCount((c) => ({ ...c, [face]: Math.max(0, (c[face] || 0) + d) }));

  const open = [
    ...orders.filter((b) => billState(b) === "unpaid").map((b) => ({ b, c: "var(--wait)", label: t("Still unpaid") })),
    ...orders.filter((b) => billState(b) === "checkUpi").map((b) => ({ b, c: "var(--violet)", label: t("UPI to check") })),
    ...orders.filter((b) => billState(b) === "cancelled").map((b) => ({ b, c: "var(--done)", label: t("Cancelled"), note: b.cancelReason })),
    ...orders.filter((b) => billState(b) !== "cancelled" && b.discount > 0).map((b) => ({ b, c: "var(--live)", label: t("Discount {amount}", { amount: money(b.discount) }), note: b.coupon?.code })),
  ];

  const summary = [
    restaurantName ? `*${restaurantName}*` : "",
    t("Day summary · {date}", { date: fmtDate(new Date(), { weekday: "short", day: "numeric", month: "short" }) }),
    `${t("Invoices")}: ${fmtNum(o.count)} · ${t("Billed")}: ${money(o.billed)}`,
    `${t("Cash received")}: ${money(o.cash)} · ${t("Online received")}: ${money(o.online)}`,
    `${t("To collect")}: ${money(o.toCollect)} · ${t("UPI to check")}: ${money(o.checkUpi)}`,
    `${t("Discounts")}: ${money(o.discount)} · ${t("Cancelled")}: ${money(o.cancelled)}`,
    counted ? `${t("Cash counted")}: ${money(counted)} (${diff === 0 ? t("matches") : diff < 0 ? t("short by {amount}", { amount: money(-diff) }) : t("over by {amount}", { amount: money(diff) })})` : "",
  ].filter(Boolean).join("\n");

  return (
    <div className="inv-two">
      <div className="zc-card inv-panel">
        <div className="inv-step"><span className="sn">1</span>{t("Today's bills")} <span className="inv-hint">{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "short" })}</span></div>
        <div className="inv-kv"><span>{t("Invoices")}</span><b>{fmtNum(o.count)}</b></div>
        <div className="inv-kv"><span>{t("Billed")}</span><b>{money(o.billed)}</b></div>
        <div className="inv-kv"><span>{t("Cash received")}</span><b style={{ color: "var(--ready-ink)" }}>{money(o.cash)}</b></div>
        <div className="inv-kv"><span>{t("Online received")}</span><b style={{ color: "var(--ready-ink)" }}>{money(o.online)}</b></div>
        <div className="inv-kv"><span>{t("To collect")}</span><b style={o.toCollect ? { color: "var(--wait-ink)" } : undefined}>{money(o.toCollect)}</b></div>
        <div className="inv-kv"><span>{t("UPI to check")}</span><b style={o.checkUpi ? { color: "var(--accent-ink)" } : undefined}>{money(o.checkUpi)}</b></div>
        <div className="inv-kv"><span>{t("Discounts")}</span><b>{money(o.discount)}</b></div>
        <div className="inv-kv"><span>{t("Cancelled")}</span><b>{money(o.cancelled)}</b></div>

        <div className="inv-step" style={{ marginTop: 18 }}><span className="sn">3</span>{t("Anything still open")}</div>
        {open.length === 0 ? <div className="inv-hint">✓ {t("Nothing open — every bill today is settled.")}</div> : open.map(({ b, c, label, note }, i) => (
          <div key={`${b._id}-${i}`} className="inv-ocheck">
            <span className="inv-dot" style={{ background: c }} />
            <div>{label} · {b.orderId} · {money(b.total)}<small>{custName(b) || t("Walk-in guest")} · {fmtTime(b.createdAt)}{note ? ` · ${note}` : ""}</small></div>
            <button type="button" className="zc-btn sm ghost" onClick={() => onOpen(b)}>{t("Review")}</button>
          </div>
        ))}
      </div>

      <div className="zc-card inv-panel">
        <div className="inv-step"><span className="sn">2</span>{t("Count the cash drawer")}</div>
        <label className="inv-kv" style={{ alignItems: "center" }}>
          <span>{t("Opening cash in the drawer")}</span>
          <input className="zc-input" type="number" min="0" inputMode="numeric" value={count.opening || ""} placeholder="0"
            onChange={(e) => setCount((c) => ({ ...c, opening: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} style={{ width: 110, textAlign: "right" }} />
        </label>
        <div className="inv-den" style={{ marginTop: 10 }}>
          {FACES.map((f) => (
            <div className="inv-dn" key={f}>
              <div className="face">₹{fmtNum(f)}</div>
              <div className="ctr">
                <button type="button" onClick={() => step(f, -1)} aria-label={t("Less")}>−</button>
                <b>{fmtNum(count[f] || 0)}</b>
                <button type="button" onClick={() => step(f, 1)} aria-label={t("More")}>+</button>
              </div>
              <small>{money(f * (count[f] || 0))}</small>
            </div>
          ))}
          <div className="inv-dn">
            <div className="face">{t("Coins")}</div>
            <input className="zc-input" type="number" min="0" inputMode="numeric" value={count.coins || ""} placeholder="0"
              onChange={(e) => setCount((c) => ({ ...c, coins: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} style={{ marginTop: 6, textAlign: "center", padding: "5px 6px" }} aria-label={t("Coins")} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="inv-kv"><span>{t("Opening cash")} + {t("Cash received")}</span><b>{money(expected)}</b></div>
          <div className="inv-kv"><span>{t("Cash counted")}</span><b>{money(counted)}</b></div>
        </div>
        {counted > 0 && (
          diff === 0 ? <div className="inv-result ok"><span>{t("Drawer matches")}</span><b>₹0</b></div>
            : diff < 0 ? <div className="inv-result short"><span>{t("Drawer is short by")}</span><b>{money(-diff)}</b></div>
              : <div className="inv-result over"><span>{t("Drawer is over by")}</span><b>{money(diff)}</b></div>
        )}
        <p className="inv-hint" style={{ margin: "10px 0 0" }}>{t("The count stays on this device only and changes no bill.")}</p>

        <div className="inv-step" style={{ marginTop: 18 }}><span className="sn">4</span>{t("Send the day's summary")}</div>
        <a className="zc-btn pri block" href={waLink(ownerPhone, summary)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
          WhatsApp {t("summary")}
        </a>
      </div>
    </div>
  );
}

