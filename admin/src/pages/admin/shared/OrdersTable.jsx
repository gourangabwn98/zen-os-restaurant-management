// src/pages/admin/shared/OrdersTable.jsx
import { useEffect, useState } from "react";
import { PINK, STATUS_STYLE } from "./constants";
import Badge from "./Badge";
import toast from "react-hot-toast";
import {
  updateOrderStatus, confirmOrder, rejectOrder, updateOrderPayment,
} from "../../../services/adminService";

// Canonical status machine (Phase 1). READY/DELIVERED/COMPLETED/CANCELLED
// are reachable from the dropdown; CONFIRMED has its own dedicated button
// below since confirming is a distinct, higher-stakes action (it deducts
// stock and creates the KOT job) rather than a routine dropdown pick.
const NEXT_STATUS_OPTIONS = ["PREPARING", "READY", "DELIVERED", "COMPLETED", "CANCELLED"];

const PAYMENT_OPTIONS = ["PENDING_VERIFICATION", "PAID", "FAILED"];
const PAYMENT_LABEL = { PENDING_VERIFICATION: "Pending", PAID: "Paid", FAILED: "Failed" };

export default function OrdersTable({ rows: initialRows, hideAction = false }) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { setRows(initialRows); }, [initialRows]);

  const patchRow = (orderId, patch) =>
    setRows((prev) => prev.map((row) => (row._id === orderId ? { ...row, ...patch } : row)));

  const handleConfirm = async (order) => {
    setBusyId(order._id);
    try {
      const { data } = await confirmOrder(order._id);
      patchRow(order._id, { status: "CONFIRMED" });
      toast.success(`Order ${order.orderId || ""} confirmed${data?.kotJob ? " · KOT sent" : ""}`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't confirm order");
    } finally { setBusyId(null); }
  };

  const handleReject = async (order) => {
    if (!window.confirm(`Reject order ${order.orderId || ""}? This cancels it.`)) return;
    setBusyId(order._id);
    try {
      await rejectOrder(order._id, "Rejected by admin");
      patchRow(order._id, { status: "CANCELLED" });
      toast.success("Order rejected");
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't reject order");
    } finally { setBusyId(null); }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    if (!newStatus) return;
    if (!window.confirm(`Change order status to "${newStatus}"?`)) return;
    const originalRows = [...rows];
    patchRow(orderId, { status: newStatus });
    try {
      await updateOrderStatus(orderId, newStatus);
      toast.success(`Order updated to ${newStatus}`);
    } catch (err) {
      setRows(originalRows);
      toast.error(err.response?.data?.message || "Failed to update status");
    }
  };

  const handlePaymentChange = async (orderId, paymentStatus) => {
    if (!paymentStatus) return;
    const originalRows = [...rows];
    patchRow(orderId, { paymentStatus });
    try {
      await updateOrderPayment(orderId, { paymentStatus });
      toast.success(`Payment marked ${PAYMENT_LABEL[paymentStatus]}`);
    } catch (err) {
      setRows(originalRows);
      toast.error(err.response?.data?.message || "Failed to update payment");
    }
  };

  if (!rows?.length) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#4b5563" }}>
        No orders found
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {[
              "Order ID", "Table No", "Customer", "Items", "Total", "Type",
              "Status", "Payment", "Time", !hideAction && "Action",
            ].filter(Boolean).map((h) => (
              <th key={h} style={{
                textAlign: "left", padding: "10px 12px", fontSize: 11, color: "#6b7280",
                borderBottom: "0.5px solid #eee", fontWeight: 500, whiteSpace: "nowrap",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => {
            const isPending = o.status === "PENDING_CONFIRMATION";
            const isBusy = busyId === o._id;
            return (
              <tr key={i} style={{ borderBottom: "0.5px solid #f5f5f5" }}>
                <td style={{ padding: "11px 12px", fontWeight: 500, color: PINK }}>
                  {o.orderId || o._id?.slice(-8)}
                  {o.source && (
                    <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 400 }}>{o.source}</div>
                  )}
                </td>
                <td style={{ padding: "11px 12px", color: "#d1cfe0" }}>
                  {o.tableNo ? `Table ${o.tableNo}` : "—"}
                </td>
                <td style={{ padding: "11px 12px" }}>
                  <div>{o.user?.name || o.guestName || (o.isGuest ? "Guest" : "—")}</div>
                  <div style={{ fontSize: 11, color: "#374151" }}>
                    {o.user?.phone || o.guestPhone || "—"}
                  </div>
                </td>
                <td style={{ padding: "11px 12px", fontSize: 12, color: "#6b7280", maxWidth: 160 }}>
                  {o.items?.map((i) => `${i.name} ×${i.qty}`).join(", ")}
                </td>
                <td style={{ padding: "11px 12px", fontWeight: 500 }}>₹{o.total}</td>
                <td style={{ padding: "11px 12px", fontSize: 12 }}>{o.orderType}</td>
                <td style={{ padding: "11px 12px" }}>
                  <Badge label={o.status} />
                </td>
                <td style={{ padding: "11px 12px" }}>
                  {hideAction ? (
                    <Badge label={o.paymentStatus} />
                  ) : (
                    <select
                      onChange={(e) => handlePaymentChange(o._id, e.target.value)}
                      value={o.paymentStatus || "PENDING_VERIFICATION"}
                      style={selectStyle}
                    >
                      {PAYMENT_OPTIONS.map((p) => (
                        <option key={p} value={p}>{PAYMENT_LABEL[p]}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ padding: "11px 12px", fontSize: 12, color: "#374151" }}>
                  {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                {!hideAction && (
                  <td style={{ padding: "11px 12px" }}>
                    {isPending ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button disabled={isBusy} onClick={() => handleConfirm(o)} style={confirmBtnStyle}>
                          {isBusy ? "…" : "✓ Confirm"}
                        </button>
                        <button disabled={isBusy} onClick={() => handleReject(o)} style={rejectBtnStyle}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <select
                        onChange={(e) => handleStatusChange(o._id, e.target.value)}
                        value=""
                        style={selectStyle}
                      >
                        <option value="" disabled>Update</option>
                        {NEXT_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const selectStyle = {
  padding: "4px 8px", borderRadius: 8, border: "0.5px solid #ddd",
  fontSize: 11, background: "#1e1a2e", color: "#e5e7eb", cursor: "pointer",
};

const confirmBtnStyle = {
  padding: "5px 10px", borderRadius: 8, border: "none", background: "#16a34a",
  color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
};

const rejectBtnStyle = {
  padding: "5px 9px", borderRadius: 8, border: "1px solid #ef4444", background: "transparent",
  color: "#f87171", fontSize: 11, fontWeight: 700, cursor: "pointer",
};
