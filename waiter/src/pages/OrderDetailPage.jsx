import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  getOrder, confirmOrder, rejectOrder, updateOrderStatus, addItemsToOrder,
  updateOrderPayment, getCombinedBill, printBill,
} from "../services/orderService.js";
import { getMenu } from "../services/menuService.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { Loader, ErrorState } from "../components/StateViews.jsx";
import { BLUE, GREEN, AMBER, RED, TEXT_MUTED, TEXT_FAINT, BORDER, BG } from "../theme.js";

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

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{order.orderId}</div>
          <div style={{ fontSize: 11.5, color: TEXT_FAINT, marginTop: 2 }}>
            {order.orderType === "DINE_IN" ? `Dine-in · Table ${order.tableNo}` : "Takeaway"} · {order.source}
          </div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div style={{ margin: "14px 16px", padding: "12px 14px", background: BG, borderRadius: 12, border: `1px solid ${BORDER}` }}>
        {(order.items || []).map((it, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
            <span>{it.name} × {it.qty}{it.notes ? <span style={{ color: TEXT_FAINT }}> · "{it.notes}"</span> : ""}</span>
            <span style={{ fontWeight: 600 }}>₹{it.price * it.qty}</span>
          </div>
        ))}
        <div style={{ borderTop: `1px dashed ${BORDER}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
          <span>Total</span><span>₹{order.total}</span>
        </div>
      </div>

      {/* Payment */}
      <div style={{ margin: "0 16px 14px", padding: "12px 14px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: TEXT_MUTED }}>Payment · {order.paymentMethod}</div>
          <span style={{ fontSize: 12, fontWeight: 800, color: paymentColor(order.paymentStatus) }}>
            {PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus}
          </span>
        </div>
        {order.paymentStatus !== "PAID" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button disabled={busy} onClick={() => handlePayment("PAID")} style={smallBtn(GREEN, "#fff")}>Mark Paid</button>
            <button disabled={busy} onClick={() => handlePayment("FAILED")} style={smallBtn("#fff", RED, RED)}>Mark Failed</button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {isPending && (
          <div style={{ display: "flex", gap: 10 }}>
            <button disabled={busy} onClick={handleConfirm} style={{ ...bigBtn, background: GREEN }}>
              ✓ Confirm Order
            </button>
            <button disabled={busy} onClick={handleReject} style={{ ...bigBtn, background: "#fff", color: RED, border: `1.5px solid ${RED}` }}>
              ✕ Reject
            </button>
          </div>
        )}

        {canAdvance && (
          <button disabled={busy} onClick={handleAdvance} style={{ ...bigBtn, background: BLUE }}>
            {NEXT_LABEL[order.status]}
          </button>
        )}

        {canAddItems && (
          <button disabled={busy} onClick={openAddItems} style={{ ...bigBtn, background: "#fff", color: BLUE, border: `1.5px solid ${BLUE}` }}>
            + Add Items
          </button>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleBill} style={{ ...bigBtn, flex: 1, background: "#fff", color: TEXT_MUTED, border: `1.5px solid ${BORDER}` }}>
            🧾 Generate Bill
          </button>
          <button onClick={handlePrint} style={{ ...bigBtn, flex: 1, background: "#fff", color: TEXT_MUTED, border: `1.5px solid ${BORDER}` }}>
            🖨️ Print Bill
          </button>
        </div>
      </div>

      {bill && (
        <div style={{ margin: "14px 16px", padding: "14px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Bill</div>
          {(bill.mergedItems || []).map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
              <span>{it.name} × {it.qty}</span><span>₹{it.price * it.qty}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px dashed ${BORDER}`, marginTop: 8, paddingTop: 8 }}>
            <Row label="Subtotal" value={`₹${bill.subtotal}`} />
            {bill.tax > 0 && <Row label="GST" value={`₹${bill.tax}`} />}
            {bill.serviceCharge > 0 && <Row label="Service Charge" value={`₹${bill.serviceCharge}`} />}
            <Row label="Grand Total" value={`₹${bill.grandTotal}`} bold />
          </div>
        </div>
      )}

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "75vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Add Items</div>
            {menuItems.map((it) => (
              <div key={it._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 13 }}>{it.name} · ₹{it.price}</div>
                <input
                  type="number" min="0" value={addQtys[it._id] || ""}
                  onChange={(e) => setAddQtys((p) => ({ ...p, [it._id]: Number(e.target.value) || 0 }))}
                  style={{ width: 54, padding: "6px 8px", borderRadius: 8, border: `1px solid ${BORDER}`, textAlign: "center" }}
                />
              </div>
            ))}
            <button disabled={busy} onClick={submitAddItems} style={{ ...bigBtn, width: "100%", background: BLUE, marginTop: 14 }}>
              Add to Order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: bold ? 14 : 12.5, fontWeight: bold ? 800 : 500 }}>
    <span>{label}</span><span>{value}</span>
  </div>
);

const bigBtn = { padding: 14, borderRadius: 12, border: "none", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer", flex: 1 };
const smallBtn = (bg, color, border) => ({
  flex: 1, padding: "9px 10px", borderRadius: 10, fontWeight: 700, fontSize: 12.5,
  border: border ? `1.5px solid ${border}` : "none", background: bg, color, cursor: "pointer",
});
