// src/pages/admin/invoices/DuesView.jsx
// Who still owes money, across all dates: named customers (bulk "mark paid"
// kept from the previous build + a WhatsApp reminder), how old the dues are,
// walk-in guests, and Online/UPI bills still to be checked.
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Loader, EmptyState } from "../shared/index.js";
import ErrorState from "../shared/ErrorState.jsx";
import { StateBadge } from "./InvoiceDrawer.jsx";
import { t, tn, fmtDate, fmtTime } from "../../../i18n/core.js";
import { billState, custName, custPhone, money, daysOld, waLink } from "./model.js";

const initials = (n) => n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

export default function DuesView({ orders, error, onRetry, restaurantName, onOpen, onCollect, onMarkPaid }) {
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(null);

  const { named, guests, upi, all } = useMemo(() => {
    const open = (orders || []).filter((o) => ["unpaid", "checkUpi"].includes(billState(o)));
    const unpaid = open.filter((o) => billState(o) === "unpaid");
    const map = {};
    for (const o of unpaid) {
      const name = custName(o), phone = custPhone(o);
      if (!name && !phone) continue;
      const key = phone || name.toLowerCase();
      (map[key] ||= { key, name: name || `+91 ${phone}`, phone, list: [] }).list.push(o);
    }
    const namedList = Object.values(map)
      .map((c) => ({ ...c, total: c.list.reduce((s, o) => s + Number(o.total || 0), 0), oldest: Math.max(...c.list.map((o) => daysOld(o.createdAt))) }))
      .sort((a, b) => b.total - a.total);
    return {
      named: namedList,
      guests: unpaid.filter((o) => !custName(o) && !custPhone(o)),
      upi: open.filter((o) => billState(o) === "checkUpi"),
      all: unpaid,
    };
  }, [orders]);

  if (error) return <div className="zc-card"><ErrorState onRetry={onRetry} /></div>;
  if (!orders) return <div className="zc-card inv-panel"><Loader rows={5} /></div>;

  const sum = (list) => list.reduce((s, o) => s + Number(o.total || 0), 0);
  const age = [
    { label: t("This week"), c: "var(--wait)", v: sum(all.filter((o) => daysOld(o.createdAt) <= 7)) },
    { label: t("8–30 days"), c: "var(--stop)", v: sum(all.filter((o) => { const d = daysOld(o.createdAt); return d > 7 && d <= 30; })) },
    { label: t("Over 30 days"), c: "var(--done)", v: sum(all.filter((o) => daysOld(o.createdAt) > 30)) },
  ];
  const ageTotal = age.reduce((s, a) => s + a.v, 0);

  const keyOf = (c, o) => `${c.key}::${o._id}`;
  const chosen = (c) => c.list.filter((o) => selected[keyOf(c, o)]);
  const payMany = async (c, list) => {
    if (!list.length) return;
    setBusy(c.key);
    try {
      await Promise.all(list.map((o) => onMarkPaid(o)));
      setSelected((p) => { const n = { ...p }; list.forEach((o) => delete n[keyOf(c, o)]); return n; });
      toast.success(tn(list.length, "{n} invoice marked paid", "{n} invoices marked paid"));
    } catch { toast.error(t("Some invoices could not be updated")); }
    finally { setBusy(null); }
  };
  const reminder = (c) => [
    restaurantName ? `*${restaurantName}*` : "",
    t("Hello {name}, your pending bills with us:", { name: c.name }),
    ...c.list.map((o) => `${o.orderId} · ${fmtDate(o.createdAt, { day: "2-digit", month: "2-digit" })} · ${money(o.total)}`),
    t("Total due: {amount}", { amount: money(c.total) }),
  ].filter(Boolean).join("\n");

  return (
    <div className="inv-two">
      <div className="zc-card inv-panel">
        <h4>{t("Customers who owe you")} <span className="inv-hint">{tn(named.length, "{n} customer", "{n} customers")} · {money(sum(named.flatMap((c) => c.list)))}</span></h4>
        {named.length === 0 ? (
          <EmptyState title={t("No named customer owes you anything")} />
        ) : named.map((c) => {
          const sel = chosen(c);
          return (
            <div key={c.key} style={{ borderTop: "1px solid var(--edge)", padding: "12px 0" }}>
              <div className="inv-due" style={{ borderTop: 0, padding: 0 }}>
                <span className="inv-av">{initials(c.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13.5 }}>{c.name}</b>
                  <div className="inv-hint">
                    {c.phone ? `+91 ${c.phone} · ` : ""}{tn(c.list.length, "{n} invoice", "{n} invoices")}
                    {c.oldest > 0 ? ` · ${tn(c.oldest, "oldest {n} day", "oldest {n} days")}` : ""}
                  </div>
                </div>
                <div className="r">
                  <span className="inv-amt" style={{ color: "var(--stop-ink)" }}>{money(c.total)}</span>
                  {c.phone && <a className="zc-btn sm ghost" href={waLink(c.phone, reminder(c))} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{t("Remind")}</a>}
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                {c.list.map((o) => {
                  const on = !!selected[keyOf(c, o)];
                  return (
                    <div key={o._id} className="inv-ocheck" style={{ borderTop: 0, padding: "4px 0" }}>
                      <button type="button" className="inv-check" aria-pressed={on} style={{ margin: 0, padding: 0, border: 0, background: "none", width: "auto" }}
                        onClick={() => setSelected((p) => ({ ...p, [keyOf(c, o)]: !on }))} aria-label={o.orderId}>
                        <i>{on ? "✓" : ""}</i>
                      </button>
                      <button type="button" onClick={() => onOpen(o)} style={{ all: "unset", cursor: "pointer", minWidth: 0 }}>
                        <span className="tnum">{o.orderId}</span>
                        <small>{fmtDate(o.createdAt, { day: "numeric", month: "short" })} · {fmtTime(o.createdAt)}</small>
                      </button>
                      <span className="inv-amt">{money(o.total)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="inv-dr-acts" style={{ marginTop: 8 }}>
                <button type="button" className="zc-btn sm pri" disabled={!sel.length || busy === c.key} onClick={() => payMany(c, sel)}>
                  {t("Mark paid")} · {money(sum(sel))}
                </button>
                <button type="button" className="zc-btn sm" disabled={busy === c.key} onClick={() => payMany(c, c.list)}>
                  {t("All")} · {money(c.total)}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="zc-card inv-panel">
          <h4>{t("How old the dues are")} <span className="inv-hint">{money(ageTotal)}</span></h4>
          <div className="inv-agebar" aria-hidden="true">
            {age.map((a) => a.v > 0 && <i key={a.label} style={{ width: `${(a.v / (ageTotal || 1)) * 100}%`, background: a.c }} />)}
          </div>
          <div className="inv-legend">{age.map((a) => <span key={a.label} style={{ "--c": a.c }}>{a.label} {money(a.v)}</span>)}</div>
        </div>

        <div className="zc-card inv-panel">
          <h4>{t("Walk-in guests, unpaid")} <span className="inv-hint">{money(sum(guests))}</span></h4>
          <p className="inv-hint" style={{ margin: "0 0 6px" }}>{t("Bills with no name or phone — collect at the table or counter.")}</p>
          {guests.length === 0 ? <div className="inv-hint">✓</div> : guests.map((o) => (
            <div key={o._id} className="inv-ocheck">
              <span className="inv-dot" style={{ background: "var(--wait)" }} />
              <div><span className="tnum">{o.orderId}</span><small>{fmtDate(o.createdAt, { day: "numeric", month: "short" })} · {fmtTime(o.createdAt)}{daysOld(o.createdAt) ? ` · ${tn(daysOld(o.createdAt), "{n} day old", "{n} days old")}` : ""}</small></div>
              <button type="button" className="zc-btn sm" onClick={() => onCollect(o)}>{t("Collect {amount}", { amount: money(o.total) })}</button>
            </div>
          ))}
        </div>

        <div className="zc-card inv-panel">
          <h4>{t("UPI to check")} <span className="inv-hint">{money(sum(upi))}</span></h4>
          <p className="inv-hint" style={{ margin: "0 0 6px" }}>{t("The customer chose online / UPI. Mark paid only after you see the money in your UPI app or bank SMS.")}</p>
          {upi.length === 0 ? <div className="inv-hint">✓</div> : upi.map((o) => (
            <div key={o._id} className="inv-ocheck">
              <StateBadge o={o} />
              <div><span className="tnum">{o.orderId}</span><small>{custName(o) || t("Walk-in guest")} · {fmtDate(o.createdAt, { day: "numeric", month: "short" })} {fmtTime(o.createdAt)}</small></div>
              <button type="button" className="zc-btn sm" onClick={() => onCollect(o, "Online")}>{t("Check {amount}", { amount: money(o.total) })}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
