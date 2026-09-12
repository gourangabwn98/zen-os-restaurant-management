import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  getOrder, confirmOrder, rejectOrder, updateOrderStatus, addItemsToOrder,
  updateOrderPayment, getCombinedBill, printBill,
} from "../services/orderService.js";
import { getMenu } from "../services/menuService.js";
import StatusBadge, { statusColor } from "../components/StatusBadge.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import { ACCENT, GREEN, AMBER, RED, TEXT_MUTED, TEXT_FAINT, GLASS_BORDER, GLASS_BG } from "../theme.js";

const NEXT_STATUS = {
  CONFIRMED: "PREPARING",
  PREPARING: "READY",
  READY: "DELIVERED",
  DELIVERED: "COMPLETED",
};
const NEXT_LABEL = {
  CONFIRMED: "Start Preparing",
  PREPARING: "Mark Ready",
  READY: "Mark Delivered",
  DELIVERED: "Mark Completed",
};
const STAGES = ["CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED"];

const PAYMENT_LABEL = { PENDING_VERIFICATION: "Pending verification", PAID: "Paid", FAILED: "Failed" };
const paymentColor = (s) => (s === "PAID" ? GREEN : s === "FAILED" ? RED : AMBER);

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [bill, setBill]   = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [addQtys, setAddQtys] = useState({});

  const load = useCallback(() => {
    setError(null);
    getOrder(id).then((r) => setOrder(r.data)).catch(() => setError("Couldn't load this order"));
  }, [id]);

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, [load]);

  const handleConfirm = async () => {
    setBusy(true);
    try { await confirmOrder(id); toast.success("Order confirmed · KOT sent"); load(); }
    catch (err) { toast.error(err.response?.data?.message || "Couldn't confirm"); }
    finally { setBusy(false); }
  };

  const handleReject = async () => {
    if (!window.confirm("Reject this order?")) return;
    setBusy(true);
    try { await rejectOrder(id, "Rejected by waiter"); toast.success("Order rejected"); load(); }
    catch (err) { toast.error(err.response?.data?.message || "Couldn't reject"); }
    finally { setBusy(false); }
  };

  const handleAdvance = async () => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setBusy(true);
    try { await updateOrderStatus(id, next); toast.success(`→ ${next}`); load(); }
    catch (err) { toast.error(err.response?.data?.message || "Couldn't update status"); }
    finally { setBusy(false); }
  };

  const handlePayment = async (paymentStatus) => {
    setBusy(true);
    try { await updateOrderPayment(id, { paymentStatus }); toast.success(`Payment marked ${PAYMENT_LABEL[paymentStatus]}`); load(); }
    catch (err) { toast.error(err.response?.data?.message || "Couldn't update payment"); }
    finally { setBusy(false); }
  };

  const openAddItems = () => {
    setShowAdd(true);
    if (menuItems.length === 0) getMenu({}).then((r) => setMenuItems(r.data || [])).catch(() => {});
  };

  const submitAddItems = async () => {
    const items = Object.entries(addQtys).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty }));
    if (items.length === 0) return toast.error("Pick at least one item");
    setBusy(true);
    try {
      await addItemsToOrder(id, items);
      toast.success("Items added");
      setShowAdd(false); setAddQtys({});
      load();
    } catch (err) { toast.error(err.response?.data?.message || "Couldn't add items"); }
    finally { setBusy(false); }
  };

  const handleBill = async () => {
    try {
      const { data } = await getCombinedBill({ orderIds: id });
      setBill(data);
    } catch (err) { toast.error(err.response?.data?.message || "Couldn't generate bill"); }
  };

  const handlePrint = async () => {
    try { await printBill(id); toast.success("Sent to printer"); }
    catch { toast.error("Couldn't reach the printer"); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!order) return <Loader label="Loading order…" />;

  const isPending = order.status === "PENDING_CONFIRMATION";
  const canAdvance = !!NEXT_STATUS[order.status];
  const canAddItems = ["CONFIRMED","PREPARING","READY"].includes(order.status);
  const stageIdx = STAGES.indexOf(order.status);

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{order.orderId}</div>
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            {order.orderType === "DINE_IN" ? `Dine-in · Table ${order.tableNo}` : "Takeaway"} · {order.source}
          </div>
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
          {(order.items || []).map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: "#fff" }}>
              <span>{it.name} × {it.qty}{it.notes ? <span style={{ color: TEXT_FAINT }}> · "{it.notes}"</span> : ""}</span>
              <span style={{ fontWeight: 600 }}>₹{it.price * it.qty}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800, color: "#fff" }}>
            <span>Total</span><span style={{ color: ACCENT }}>₹{order.total}</span>
          </div>
        </GlassCard>
      </div>

      {/* Payment */}
      <div style={{ margin: "0 16px 14px" }}>
        <GlassCard style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>Payment · {order.paymentMethod}</div>
            <span style={{ fontSize: 12, fontWeight: 800, color: paymentColor(order.paymentStatus) }}>
              {PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus}
            </span>
          </div>
          {order.paymentStatus !== "PAID" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <PrimaryButton disabled={busy} onClick={() => handlePayment("PAID")} variant="success" style={{ flex: 1, padding: "10px", fontSize: 12.5 }}>Mark Paid</PrimaryButton>
              <PrimaryButton disabled={busy} onClick={() => handlePayment("FAILED")} variant="danger" style={{ flex: 1, padding: "10px", fontSize: 12.5 }}>Mark Failed</PrimaryButton>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Actions */}
      <div style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {isPending && (
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton disabled={busy} onClick={handleConfirm} variant="success" style={{ flex: 1 }}>✓ Confirm Order</PrimaryButton>
            <PrimaryButton disabled={busy} onClick={handleReject} variant="danger" style={{ flex: 1 }}>✕ Reject</PrimaryButton>
          </div>
        )}

        {canAdvance && (
          <PrimaryButton disabled={busy} onClick={handleAdvance}>{NEXT_LABEL[order.status]}</PrimaryButton>
        )}

        {canAddItems && (
          <PrimaryButton disabled={busy} onClick={openAddItems} variant="outline">+ Add Items</PrimaryButton>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleBill} style={outlineBtn}>🧾 Generate Bill</button>
          <button onClick={handlePrint} style={outlineBtn}>🖨️ Print Bill</button>
        </div>
      </div>

      {bill && (
        <div style={{ margin: "14px 16px" }}>
          <GlassCard style={{ padding: "16px" }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: "#fff" }}>Bill</div>
            {(bill.mergedItems || []).map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", color: "#fff" }}>
                <span>{it.name} × {it.qty}</span><span>₹{it.price * it.qty}</span>
              </div>
            ))}
            <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 8, paddingTop: 8 }}>
              <Row label="Subtotal" value={`₹${bill.subtotal}`} />
              {bill.tax > 0 && <Row label="GST" value={`₹${bill.tax}`} />}
              {bill.serviceCharge > 0 && <Row label="Service Charge" value={`₹${bill.serviceCharge}`} />}
              <Row label="Grand Total" value={`₹${bill.grandTotal}`} bold />
            </div>
          </GlassCard>
        </div>
      )}

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "75vh", overflowY: "auto",
            background: "#0C0A14", border: `1px solid ${GLASS_BORDER}`, borderBottom: "none",
            borderRadius: "20px 20px 0 0", padding: 18,
          }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14, color: "#fff" }}>Add Items</div>
            {menuItems.map((it) => (
              <div key={it._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${GLASS_BORDER}` }}>
                <div style={{ fontSize: 13, color: "#fff" }}>{it.name} · ₹{it.price}</div>
                <input
                  type="number" min="0" value={addQtys[it._id] || ""}
                  onChange={(e) => setAddQtys((p) => ({ ...p, [it._id]: Number(e.target.value) || 0 }))}
                  style={{
                    width: 56, padding: "7px 8px", borderRadius: 8, border: `1px solid ${GLASS_BORDER}`,
                    background: GLASS_BG, color: "#fff", textAlign: "center",
                  }}
                />
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              <PrimaryButton disabled={busy} onClick={submitAddItems}>Add to Order</PrimaryButton>
            </div>
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
