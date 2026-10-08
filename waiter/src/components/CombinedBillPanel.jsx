// src/components/CombinedBillPanel.jsx — KH-03 / KH-07
// ONE bill for several running orders: a table's orders (KH-03), or an order
// plus the follow-ups added after its KOT (KH-07, e.g. takeaway). The waiter
// ticks which orders go on the bill (all by default), sees every item and one
// grand total, then prints / takes payment / settles them together.
// Backend: restaurant-server/services/combinedBillService.js — amounts are the
// orders' own stored figures, every id is re-checked, each write is per order
// and atomic, so a double tap or two staff at once can't double-pay anything.
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import GlassCard from "./ui/GlassCard.jsx";
import PrimaryButton from "./ui/PrimaryButton.jsx";
import {
  previewCombinedBill, printCombinedBill, payCombinedBill, settleCombinedBill, newIdempotencyKey,
} from "../services/orderService.js";
import { STATUS_LABEL } from "./StatusBadge.jsx";
import { ACCENT, GREEN, AMBER, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER } from "../theme.js";
import { t, tn, localName } from "../i18n/index.jsx";

/**
 * @param scope     { tableNo } or { groupOf }
 * @param orders    candidate orders [{ _id, orderId, status, paymentStatus, total, parentOrder }]
 * @param title     heading, e.g. "Table 5 bill"
 * @param onChanged called after a payment / settlement so the page reloads
 */
export default function CombinedBillPanel({ scope, orders, title, onChanged }) {
  const ids = useMemo(() => orders.map((o) => String(o._id)), [orders]);
  const [selected, setSelected] = useState(() => new Set(ids));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [printKey, setPrintKey] = useState(newIdempotencyKey);

  // New orders appear (e.g. a follow-up was just added) → tick them too.
  const idsKey = ids.join(",");
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      for (const id of ids) if (!prev.has(id)) next.add(id);
      return next;
    });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selKey = [...selected].sort().join(",");
  const body = useMemo(() => ({ ...scope, orderIds: [...selected] }), [selKey, scope.tableNo, scope.groupOf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected.size) { setPreview(null); return undefined; }
    let gone = false;
    previewCombinedBill(body).then(({ data }) => { if (!gone) setPreview(data); }).catch(() => { if (!gone) setPreview(null); });
    setPrintKey(newIdempotencyKey()); // a new selection is a new print intent
    return () => { gone = true; };
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async (fn, okMsg) => {
    if (!selected.size) return toast.error(t("Tick at least one order"));
    setBusy(true);
    try {
      const { data } = await fn();
      const why = data?.rejected?.[0]?.reason;
      if (why) toast.error(why); else toast.success(okMsg(data));
      onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't do that — try again")); }
    finally { setBusy(false); }
  };

  const handlePrint = () => run(
    () => printCombinedBill({ ...body, requestKey: printKey }),
    (d) => (d.duplicate ? t("Already sent to the printer") : t("Combined bill sent to printer")),
  );
  const handleSettle = (paymentMethod) => run(
    () => settleCombinedBill({ ...body, paymentMethod }),
    (d) => tn(d.settled?.length || 0, "{n} bill settled", "{n} bills settled"),
  );
  const handlePaid = (paymentMethod) => run(
    () => payCombinedBill({ ...body, paymentMethod }),
    (d) => tn(d.paid?.length || 0, "{n} order marked paid", "{n} orders marked paid"),
  );

  const totals = preview?.totals;
  const allPaid = !!totals?.allPaid;

  return (
    <GlassCard style={{ padding: "14px 16px" }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>🧾 {title}</div>
      <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
        {t("One bill for the ticked orders — every item, one grand total.")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {orders.map((o) => {
          const id = String(o._id);
          return (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#fff", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} style={{ width: 18, height: 18 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{o.orderId}</b>
                {o.parentOrder ? <span style={{ color: TEXT_FAINT }}> · {t("added later")}</span> : null}
                <span style={{ color: TEXT_FAINT }}> · {t(STATUS_LABEL[o.status] || o.status)}</span>
                {o.paymentStatus === "PAID" && <span style={{ color: GREEN }}> · {t("Paid")}</span>}
              </span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>₹{o.total}</span>
            </label>
          );
        })}
      </div>

      {preview && (
        <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 10, paddingTop: 8 }}>
          {preview.orders.map((o) => (
            <div key={o._id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: TEXT_FAINT, fontWeight: 700 }}>{o.orderId}</div>
              {o.items.map((it, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "#fff", padding: "1px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{localName(it)} × {it.qty}</span><span>₹{it.price * it.qty}</span>
                  </div>
                  {(it.addons || []).map((a) => <div key={a.name} style={{ fontSize: 11.5, color: "#93C5FD" }}>+ {a.name}</div>)}
                </div>
              ))}
            </div>
          ))}
          {totals?.tax > 0 && <Line label={t("GST")} value={`₹${totals.tax}`} />}
          {totals?.serviceCharge > 0 && <Line label={t("Service charge")} value={`₹${totals.serviceCharge}`} />}
          {totals?.discount > 0 && <Line label={t("Coupon discount")} value={`−₹${totals.discount}`} />}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 800, color: "#fff", marginTop: 6 }}>
            <span style={{ fontSize: 14 }}>{t("Grand total")}</span>
            <span style={{ color: ACCENT, fontSize: 21, fontVariantNumeric: "tabular-nums" }}>₹{totals?.total ?? 0}</span>
          </div>
          {totals && totals.paidTotal > 0 && !allPaid && (
            <Line label={t("Still to pay")} value={`₹${totals.dueTotal}`} color={AMBER} />
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        <PrimaryButton disabled={busy || !selected.size} variant="outline" onClick={handlePrint}>🖨️ {t("Print combined bill")}</PrimaryButton>
        {allPaid ? (
          <PrimaryButton disabled={busy || !selected.size} variant="success" onClick={() => handleSettle()}>{t("Settle all")}</PrimaryButton>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton disabled={busy || !selected.size} variant="success" onClick={() => handleSettle("Cash")} style={{ flex: 1, padding: 10, fontSize: 12.5 }}>{t("Cash · settle all")}</PrimaryButton>
              <PrimaryButton disabled={busy || !selected.size} variant="success" onClick={() => handleSettle("Online")} style={{ flex: 1, padding: 10, fontSize: 12.5 }}>{t("Online · settle all")}</PrimaryButton>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={busy || !selected.size} onClick={() => handlePaid("Cash")} style={smallBtn}>{t("Mark paid (Cash)")}</button>
              <button type="button" disabled={busy || !selected.size} onClick={() => handlePaid("Online")} style={smallBtn}>{t("Mark paid (Online)")}</button>
            </div>
          </>
        )}
      </div>
    </GlassCard>
  );
}

const Line = ({ label, value, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: color || TEXT_MUTED, padding: "2px 0" }}>
    <span>{label}</span><span>{value}</span>
  </div>
);

const smallBtn = {
  flex: 1, padding: 9, borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 12,
  border: `1.5px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.05)", color: TEXT_MUTED,
};
