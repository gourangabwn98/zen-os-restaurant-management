import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  getOrder, confirmOrder, rejectOrder, updateOrderStatus,
  updateOrderPayment, getCombinedBill, printBill, modifyOrderItems, settleOrders,
  placeOrder, getOrderGroup, newIdempotencyKey,
} from "../services/orderService.js";
import CombinedBillPanel from "../components/CombinedBillPanel.jsx";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import StatusBadge, { statusColor } from "../components/StatusBadge.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import QtyStepper, { AddButton } from "../components/ui/QtyStepper.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
import { ACCENT, GREEN, AMBER, RED, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, GLASS_BG } from "../theme.js";
import { t, N_, tn, localName } from "../i18n/index.jsx";
import NotShareableNote from "../components/NotShareableNote.jsx";
import { DINING_AREA_LABEL } from "../utils/diningArea.js";
import { STATUS_LABEL } from "../components/StatusBadge.jsx";

// DSH-04: the floor steps a waiter drives. Kitchen marks Ready; the waiter
// taps Served (→ Eating). Completed is NOT here — it follows from settling
// the bill (BIL-02), never a button on the order.
const NEXT_STATUS = {
  CONFIRMED: "PREPARING",
  PREPARING: "READY",
  READY: "DELIVERED",
};
const NEXT_LABEL = {
  CONFIRMED: N_("Send to kitchen now"),
  PREPARING: N_("Mark ready"),
  READY: N_("Served"),
};
const STAGES = ["CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED"];
// Bill can be settled once the order is accepted (server: billingService.SETTLEABLE).
const SETTLEABLE = ["CONFIRMED", "PREPARING", "READY", "DELIVERED"];
const billSettled = (o) => (o.billStatus ? o.billStatus === "SETTLED" : o.status === "COMPLETED");

const PAYMENT_LABEL = { PENDING_VERIFICATION: N_("Pending verification"), PAID: N_("Paid"), FAILED: N_("Failed") };
const paymentColor = (s) => (s === "PAID" ? GREEN : s === "FAILED" ? RED : AMBER);

const lineId = (it) => String(it.menuItem?._id ?? it.menuItem);

/** "Starts preparing in 2:42" for a Placed order (it can still be changed). */
function SendCountdown({ order }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (order.sendError) return <span style={{ color: RED }}>{t("Couldn't start preparing automatically")} — {order.sendError}</span>;
  if (!order.autoPrepareAt) return <span>{t("Start preparing when ready")}</span>;
  const left = Math.max(0, Math.ceil((new Date(order.autoPrepareAt).getTime() - now) / 1000));
  if (!left) return <span>{t("Starting preparation…")}</span>;
  return <span>{t("Goes to the kitchen in")} <b style={{ fontVariantNumeric: "tabular-nums" }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b> — {t("can still be changed")}</span>;
}

export default function OrderDetailPage() {
  const { id } = useParams();

  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  // Inline quantity edit while the order is still editable (null = not editing).
  const [editLines, setEditLines] = useState(null);
  const [bill, setBill]   = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [menuItems, setMenuItems] = useState(null); // null = loading
  const [menuCategories, setMenuCategories] = useState([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCategory, setMenuCategory] = useState("");
  const [addQtys, setAddQtys] = useState({});
  const [addKey, setAddKey] = useState(newIdempotencyKey); // KH-07: one follow-up per "add" tap
  // KH-03 / KH-07: the running orders billed together with this one — the
  // table's orders (dine-in) or this order + its follow-ups (takeaway).
  const [billGroup, setBillGroup] = useState(null);

  const loadBillGroup = useCallback(async (o) => {
    if (!o || !SETTLEABLE.includes(o.status)) { setBillGroup(null); return; }
    try {
      if (o.orderType === "DINE_IN" && o.tableNo) {
        const { data } = await getCombinedBill({ tableNo: o.tableNo });
        setBillGroup({ scope: { tableNo: o.tableNo }, orders: (data.orders || []).filter((x) => SETTLEABLE.includes(x.status)) });
      } else {
        const { data } = await getOrderGroup(o._id);
        setBillGroup({ scope: { groupOf: data.rootId }, orders: (data.orders || []).filter((x) => SETTLEABLE.includes(x.status)) });
      }
    } catch { setBillGroup(null); }
  }, []);

  const load = useCallback(() => {
    setError(null);
    getOrder(id).then((r) => { setOrder(r.data); loadBillGroup(r.data); }).catch(() => setError(t("Couldn't load this order")));
  }, [id, loadBillGroup]);

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, [load]);

  const handleConfirm = async () => {
    setBusy(true);
    try { await confirmOrder(id); toast.success(t("Order accepted — it goes to the kitchen when the change window ends")); load(); }
    catch (err) { toast.error(err.response?.data?.message || t("Couldn't accept the order")); }
    finally { setBusy(false); }
  };

  const handleReject = async () => {
    if (!window.confirm(t("Cancel this order?"))) return;
    setBusy(true);
    try { await rejectOrder(id, "Cancelled by waiter"); toast.success(t("Order cancelled")); load(); }
    catch (err) { toast.error(err.response?.data?.message || t("Couldn't cancel")); }
    finally { setBusy(false); }
  };

  const handleAdvance = async () => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setBusy(true);
    try { await updateOrderStatus(id, next); toast.success(`→ ${t(STATUS_LABEL[next] || next)}`); load(); }
    catch (err) { toast.error(err.response?.data?.message || t("Couldn't update status")); }
    finally { setBusy(false); }
  };

  // BIL-01/02: settle the bill — collects the payment if it isn't recorded
  // yet. The server completes the order if it has been served.
  const handleSettle = async (paymentMethod) => {
    setBusy(true);
    try {
      const { data } = await settleOrders([id], paymentMethod);
      const why = data?.rejected?.[0]?.reason;
      if (why) toast.error(why);
      else toast.success(data?.completed?.length ? t("Bill settled — order completed") : t("Bill settled"));
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't settle the bill")); }
    finally { setBusy(false); }
  };

  const handlePayment = async (paymentStatus) => {
    setBusy(true);
    try { await updateOrderPayment(id, { paymentStatus }); toast.success(t("Payment marked {s}", { s: t(PAYMENT_LABEL[paymentStatus]) })); load(); }
    catch (err) { toast.error(err.response?.data?.message || t("Couldn't update payment")); }
    finally { setBusy(false); }
  };

  const openAddItems = () => {
    setShowAdd(true);
    setMenuSearch(""); setMenuCategory(""); setAddQtys({});
    if (menuCategories.length === 0) getMenuCategories().then((r) => setMenuCategories(r.data || [])).catch(() => {});
  };

  // Re-queried whenever the search/category filter changes, same debounced
  // pattern as NewOrderPage.jsx's menu browser — this modal is the same
  // "pick from the live menu" job, just against an existing order.
  useEffect(() => {
    if (!showAdd) return;
    const t = setTimeout(() => {
      getMenu({ category: menuCategory || undefined, search: menuSearch || undefined })
        .then((r) => setMenuItems(Array.isArray(r.data) ? r.data : []))
        .catch(() => setMenuItems([]));
    }, 250);
    return () => clearTimeout(t);
  }, [showAdd, menuCategory, menuSearch]);

  const groupedAddItems = useMemo(() => {
    if (!menuItems) return [];
    const map = new Map();
    for (const it of menuItems) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category).push(it);
    }
    return [...map.entries()];
  }, [menuItems]);

  const getAddQty = (itemId) => addQtys[itemId] || 0;
  const adjustAddQty = (item, delta) => {
    setAddQtys((prev) => {
      const next = Math.max(0, (prev[item._id] || 0) + delta);
      return { ...prev, [item._id]: next };
    });
  };
  const addItemCount = Object.values(addQtys).reduce((s, q) => s + q, 0);

  const submitAddItems = async () => {
    const items = Object.entries(addQtys).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty }));
    if (items.length === 0) return toast.error(t("Pick at least one item"));
    setBusy(true);
    try {
      if ((order.status === "CONFIRMED" || order.status === "PENDING_CONFIRMATION") && !order.stockDeducted) {
        const merged = new Map((order.items || []).map((it) => [lineId(it), { menuItemId: lineId(it), qty: it.qty, notes: it.notes || "" }]));
        for (const it of items) {
          const ex = merged.get(it.menuItemId);
          merged.set(it.menuItemId, ex ? { ...ex, qty: ex.qty + it.qty } : { ...it, notes: "" });
        }
        await modifyOrderItems(id, [...merged.values()], order.revision ?? 0);
        toast.success(t("Items added"));
      } else {
        // KH-07: after the KOT → a follow-up order on a NEW KOT, billed
        // together with this one. Table / type / customer come from this order.
        const { data: added } = await placeOrder({ parentOrder: id, items, idempotencyKey: addKey });
        setAddKey(newIdempotencyKey());
        toast.success(t("Added as {id} — it goes to the kitchen on a new KOT", { id: added.orderId }));
      }
      setShowAdd(false); setAddQtys({});
      load();
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't add items")); }
    finally { setBusy(false); }
  };

  const startEdit = () => setEditLines((order.items || []).map((it) => ({
    menuItemId: lineId(it), name: it.name, price: it.price, qty: it.qty, notes: it.notes || "",
  })));
  const changeQty = (mid, d) => setEditLines((p) => p.map((l) => (l.menuItemId === mid ? { ...l, qty: Math.max(1, Math.min(99, l.qty + d)) } : l)));
  const removeLine = (mid) => setEditLines((p) => p.filter((l) => l.menuItemId !== mid));
  const saveEdit = async () => {
    if (!editLines.length) return toast.error(t("An order needs at least one item — cancel it instead"));
    setBusy(true);
    try {
      await modifyOrderItems(id, editLines.map(({ menuItemId, qty, notes }) => ({ menuItemId, qty, notes })), order.revision ?? 0);
      toast.success(t("Order updated"));
      setEditLines(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't update the order"));
      load();
    } finally { setBusy(false); }
  };

  const handleBill = async () => {
    try {
      const { data } = await getCombinedBill({ orderIds: id });
      setBill(data);
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't generate bill")); }
  };

  // Payment QR is uploaded by the admin (Profile → Payment) and comes back
  // on the bill. Scanning it is not proof of payment — still Mark Paid.
  const handleShowQr = async () => {
    try {
      // fresh — items/total may have changed; KH-03/07: the whole combined bill
      const ids = billGroup && billGroup.orders.length > 1 ? billGroup.orders.map((o) => o._id).join(",") : id;
      const { data } = await getCombinedBill({ orderIds: ids });
      setBill(data);
      if (!data.paymentQr) return toast.error(t("No payment QR yet — admin can add one in Profile → Payment"));
      setShowQr(true);
    } catch (err) { toast.error(err.response?.data?.message || t("Couldn't load the payment QR")); }
  };

  const handlePrint = async () => {
    try { await printBill(id); toast.success(t("Sent to printer")); }
    catch { toast.error(t("Couldn't reach the printer")); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!order) return <Loader label={t("Loading order…")} />;

  const isPending = order.status === "PENDING_CONFIRMATION";
  const canAdvance = !!NEXT_STATUS[order.status];
  const settled = billSettled(order);
  const canSettle = !settled && SETTLEABLE.includes(order.status);
  // ORD-01: items can change while the order is held — awaiting acceptance
  // or Placed — i.e. before its KOT prints.
  const isPlaced = order.status === "CONFIRMED" && !order.stockDeducted;
  const isHeld = (isPending || order.status === "CONFIRMED") && !order.stockDeducted;
  // KH-07: after the KOT, "Add items" places a follow-up order (new KOT).
  const canFollowUp = !isHeld && SETTLEABLE.includes(order.status) && !settled;
  const canAddItems = isHeld || canFollowUp;
  const combined = !!billGroup && billGroup.orders.length > 1;
  const stageIdx = STAGES.indexOf(order.status);

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.4 }}>{order.orderId}</div>
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            {order.orderType === "DINE_IN" ? `${order.diningArea ? t(DINING_AREA_LABEL[order.diningArea] || order.diningArea) : t("Dine-in")} · ${t("Table {n}", { n: order.tableNo })}` : t("Takeaway")} · {order.source}
          </div>
          {order.parentOrderNo && (
            <div style={{ fontSize: 11.5, color: AMBER, marginTop: 2 }}>{t("Items added to {id}", { id: order.parentOrderNo })}</div>
          )}
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Lightweight visual progress — purely derived from order.status,
          same stages the single "advance" action already moves through. */}
      {!isPending && order.status !== "CANCELLED" && (
        <div style={{ display: "flex", alignItems: "center", padding: "18px 16px 4px" }}>
          {STAGES.map((s, i) => (
            <div key={s} style={{ flex: 1, display: "flex", alignItems: "center" }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: i <= stageIdx ? statusColor(order.status) : "rgba(255,255,255,0.12)",
                boxShadow: i === stageIdx ? `0 0 10px ${statusColor(order.status)}` : "none",
              }} />
              {i < STAGES.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < stageIdx ? statusColor(order.status) : "rgba(255,255,255,0.12)" }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: "14px 16px" }}>
        <GlassCard style={{ padding: "14px 16px" }}>
          {(editLines || order.items || []).map((it, i) => (
            <div key={editLines ? it.menuItemId : i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13.5, color: "#fff" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{localName(it)}{editLines ? "" : ` × ${it.qty}`}{it.notes ? <span style={{ color: TEXT_FAINT }}> · "{it.notes}"</span> : ""}</span>
              {editLines ? (
                <>
                  <QtyStepper qty={it.qty} onDec={() => changeQty(it.menuItemId, -1)} onInc={() => changeQty(it.menuItemId, 1)} />
                  <button type="button" onClick={() => removeLine(it.menuItemId)} aria-label={t("Remove {name}", { name: it.name })}
                    style={{ background: "none", border: 0, color: RED, fontSize: 16, cursor: "pointer", padding: "0 4px" }}>✕</button>
                </>
              ) : (
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>₹{it.price * it.qty}</span>
              )}
            </div>
          ))}
          {editLines && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <PrimaryButton disabled={busy} variant="outline" onClick={() => setEditLines(null)} style={{ flex: 1, padding: "10px", fontSize: 13 }}>{t("Discard")}</PrimaryButton>
              <PrimaryButton disabled={busy || !editLines.length} onClick={saveEdit} style={{ flex: 1, padding: "10px", fontSize: 13 }}>{t("Save changes")}</PrimaryButton>
            </div>
          )}
          <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 800, color: "#fff" }}>
            <span style={{ fontSize: 14 }}>{t("Total")}</span>
            <span style={{ color: ACCENT, fontSize: 23, fontVariantNumeric: "tabular-nums", letterSpacing: -0.4 }}>₹{order.total}</span>
          </div>
        </GlassCard>
      </div>

      {/* Payment */}
      <div style={{ margin: "0 16px 14px" }}>
        <GlassCard style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>{t("Payment")} · {t(order.paymentMethod)}</div>
            <span style={{ fontSize: 12, fontWeight: 800, color: paymentColor(order.paymentStatus) }}>
              {t(PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>{t("Bill")}</div>
            <span style={{ fontSize: 12, fontWeight: 800, color: settled ? GREEN : AMBER }}>{settled ? t("Settled") : t("Open")}</span>
          </div>
          {canSettle && !combined && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {order.paymentStatus === "PAID" ? (
                <PrimaryButton disabled={busy} onClick={() => handleSettle()} variant="success" style={{ width: "100%", padding: "10px", fontSize: 12.5 }}>{t("Settle bill")} · ₹{order.total}</PrimaryButton>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <PrimaryButton disabled={busy} onClick={() => handleSettle("Cash")} variant="success" style={{ flex: 1, padding: "10px", fontSize: 12.5 }}>{t("Cash · settle")}</PrimaryButton>
                  <PrimaryButton disabled={busy} onClick={() => handleSettle("Online")} variant="success" style={{ flex: 1, padding: "10px", fontSize: 12.5 }}>{t("Online · settle")}</PrimaryButton>
                </div>
              )}
              {order.paymentStatus !== "PAID" && (
                <button type="button" disabled={busy} onClick={() => handlePayment("PAID")} style={{ ...outlineBtn, padding: 9 }}>{t("Mark paid only (settle later)")}</button>
              )}
              <div style={{ fontSize: 11.5, color: TEXT_FAINT, textAlign: "center" }}>
                {order.status === "DELIVERED" ? t("Settling completes this order and frees the table.") : t("Settling now records the bill — the order completes once it is served.")}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {combined && (
        <div style={{ margin: "0 16px 14px" }}>
          <CombinedBillPanel
            scope={billGroup.scope} orders={billGroup.orders} onChanged={load}
            title={billGroup.scope.tableNo
              ? t("Table {n} bill · {c} orders", { n: billGroup.scope.tableNo, c: billGroup.orders.length })
              : t("Bill · {c} orders", { c: billGroup.orders.length })}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {isPending && (
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton disabled={busy} onClick={handleConfirm} variant="success" style={{ flex: 1 }}>✓ {t("Accept order")}</PrimaryButton>
            <PrimaryButton disabled={busy} onClick={handleReject} variant="danger" style={{ flex: 1 }}>✕ {t("Cancel")}</PrimaryButton>
          </div>
        )}

        {isHeld && (
          <>
            {isPlaced && (
              <div style={{ fontSize: 12.5, color: order.sendError ? RED : AMBER, textAlign: "center" }}>
                <SendCountdown order={order} />
              </div>
            )}
            {!editLines && (
              <PrimaryButton disabled={busy} variant="outline" onClick={startEdit}>✎ {t("Change quantities")}</PrimaryButton>
            )}
          </>
        )}

        {canAdvance && (
          <PrimaryButton disabled={busy} onClick={handleAdvance}>
            {t(NEXT_LABEL[order.status])}
          </PrimaryButton>
        )}

        {canAddItems && (
          <PrimaryButton disabled={busy} onClick={openAddItems} variant="outline">+ {t("Add items")}</PrimaryButton>
        )}
        {canFollowUp && (
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, textAlign: "center", marginTop: -4 }}>
            {t("Already in the kitchen — added items go on a new KOT and the same bill.")}
          </div>
        )}

        {!combined && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleBill} style={outlineBtn}>🧾 {t("Generate bill")}</button>
            <button onClick={handlePrint} style={outlineBtn}>🖨️ {t("Print bill")}</button>
          </div>
        )}
        <button onClick={handleShowQr} style={{ ...outlineBtn, width: "100%" }}>📱 {t("Payment QR")}</button>
      </div>

      {bill && (
        <div style={{ margin: "14px 16px" }}>
          <GlassCard style={{ padding: "16px" }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: "#fff" }}>{t("Bill")}</div>
            {(bill.mergedItems || []).map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", color: "#fff" }}>
                <span>{localName(it)} × {it.qty}</span><span>₹{it.price * it.qty}</span>
              </div>
            ))}
            <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 8, paddingTop: 8 }}>
              <Row label={t("Subtotal")} value={`₹${bill.subtotal}`} />
              {bill.discount > 0 && <Row label={t("Coupon discount")} value={`−₹${bill.discount}`} />}
              {bill.tax > 0 && <Row label={t("GST")} value={`₹${bill.tax}`} />}
              {bill.serviceCharge > 0 && <Row label={t("Service charge")} value={`₹${bill.serviceCharge}`} />}
              <Row label={t("Grand total")} value={`₹${bill.grandTotal}`} bold />
            </div>
            {bill.paymentQr && (
              <div style={{ textAlign: "center", marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${GLASS_BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", marginBottom: 8, letterSpacing: 1 }}>{t("SCAN TO PAY")}</div>
                <img src={bill.paymentQr} alt="Payment QR" onClick={() => setShowQr(true)}
                  style={{ width: 160, height: 160, objectFit: "contain", background: "#fff", borderRadius: 10, padding: 6, cursor: "zoom-in" }} />
                {bill.upiId && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>UPI: {bill.upiId}</div>}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {showQr && bill?.paymentQr && (
        <div onClick={() => setShowQr(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 110,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>{t("Scan to pay")}</div>
          <img src={bill.paymentQr} alt="Payment QR"
            style={{ width: "min(80vw, 320px)", height: "min(80vw, 320px)", objectFit: "contain", background: "#fff", borderRadius: 14, padding: 10 }} />
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 22 }}>₹{bill.grandTotal}</div>
          {bill.upiId && <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 }}>UPI: {bill.upiId}</div>}
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{t("Tap anywhere to close · Mark Paid once received")}</div>
        </div>
      )}

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "85vh", display: "flex", flexDirection: "column",
            background: "#0C0A14", border: `1px solid ${GLASS_BORDER}`, borderBottom: "none",
            borderRadius: "20px 20px 0 0",
          }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0", flexShrink: 0 }}>
              <span style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
            </div>

            <div style={{ padding: "10px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>{t("Add items")}</div>
              <button onClick={() => setShowAdd(false)} aria-label={t("Close")} style={{
                width: 32, height: 32, borderRadius: "50%", border: `1px solid ${GLASS_BORDER}`,
                background: GLASS_BG, color: "#fff", fontSize: 14, cursor: "pointer",
              }}>✕</button>
            </div>

            <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
              <input
                value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)}
                placeholder={t("Search menu…")}
                style={{
                  width: "100%", padding: "11px 15px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
                  fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff", fontFamily: "inherit",
                }}
              />
            </div>

            {menuCategories.length > 0 && (
              <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px", flexShrink: 0 }}>
                <Chip active={!menuCategory} onClick={() => setMenuCategory("")}>{t("All")}</Chip>
                {menuCategories.map((c) => (
                  <Chip key={c.category} active={menuCategory === c.category} onClick={() => setMenuCategory(c.category)}>{c.category}</Chip>
                ))}
              </div>
            )}

            <div style={{ padding: "4px 16px 16px", overflowY: "auto" }}>
              {menuItems === null && <Loader label={t("Loading menu…")} />}
              {menuItems !== null && groupedAddItems.length === 0 && <EmptyState icon="🔎" title={t("No items found")} />}
              {groupedAddItems.map(([cat, catItems]) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", letterSpacing: 0.3, padding: "10px 2px 6px" }}>{cat}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {catItems.map((it) => {
                      const qty = getAddQty(it._id);
                      const outOfStock = it.stockTracked && !it.stockAvailable;
                      return (
                        <GlassCard key={it._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", opacity: outOfStock ? 0.5 : 1 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>{localName(it)}</div>
                            <NotShareableNote item={it} />
                            <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>₹{it.price}{outOfStock ? ` · ${t("Out of stock")}` : ""}</div>
                          </div>
                          {!outOfStock && (
                            qty > 0
                              ? <QtyStepper qty={qty} size="sm" onDec={() => adjustAddQty(it, -1)} onInc={() => adjustAddQty(it, 1)} />
                              : <AddButton size="sm" onClick={() => adjustAddQty(it, 1)} />
                          )}
                        </GlassCard>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {addItemCount > 0 && (
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${GLASS_BORDER}`, flexShrink: 0, paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}>
                <PrimaryButton disabled={busy} onClick={submitAddItems} style={{ width: "100%" }}>
                  {busy ? t("Adding…") : tn(addItemCount, "Add {n} item to order", "Add {n} items to order")}
                </PrimaryButton>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 800 : 500, color: bold ? "#fff" : "rgba(255,255,255,0.65)" }}>
    <span>{label}</span><span>{value}</span>
  </div>
);

const outlineBtn = {
  flex: 1, padding: 13, borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 12.5,
  border: `1.5px solid ${GLASS_BORDER}`, background: "rgba(255,255,255,0.05)", color: TEXT_MUTED,
};
