// src/pages/admin/shared/OrdersTable.jsx
import { useEffect, useState } from "react";
import { MANUAL_PAYMENT_STATUSES, needsPaidFirst, offersStatus, PAID_FIRST_HINT } from "./paymentRules.js";
import { PINK, STATUS_STYLE } from "./constants";
import Badge from "./Badge";
import toast from "react-hot-toast";
import { t, N_, fmtTime, fmtNum, localName } from "../../../i18n/core.js";
import {
  updateOrderStatus, confirmOrder, rejectOrder, updateOrderPayment,
} from "../../../services/adminService";

// Canonical status machine. PREPARING/READY/DELIVERED/COMPLETED/CANCELLED are
// reachable from the dropdown; CONFIRMED has its own button below. COMPLETED
// (clears the table) only for a cooking/ready/served order, locked until PAID.
const NEXT_STATUS_OPTIONS = ["PREPARING", "READY", "DELIVERED", "COMPLETED", "CANCELLED"];

const PAYMENT_OPTIONS = MANUAL_PAYMENT_STATUSES; // FAILED is never set by hand
const PAYMENT_LABEL = { PENDING_VERIFICATION: N_("Pending"), PAID: N_("Paid"), FAILED: N_("Failed") };

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
      toast.success(t(data?.kotJob ? "Order {id} confirmed · KOT sent" : "Order {id} confirmed", { id: order.orderId || "" }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't confirm order"));
    } finally { setBusyId(null); }
  };

  const handleReject = async (order) => {
    if (!window.confirm(t("Reject order {id}? This cancels it.", { id: order.orderId || "" }))) return;
    setBusyId(order._id);
    try {
      await rejectOrder(order._id, "Rejected by admin");
      patchRow(order._id, { status: "CANCELLED" });
      toast.success(t("Order rejected"));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't reject order"));
    } finally { setBusyId(null); }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    if (!newStatus) return;
    if (!window.confirm(t("Change order status to \"{status}\"?", { status: t(newStatus) }))) return;
    const originalRows = [...rows];
    patchRow(orderId, { status: newStatus });
    try {
      await updateOrderStatus(orderId, newStatus);
      toast.success(t("Order updated to {status}", { status: t(newStatus) }));
    } catch (err) {
      setRows(originalRows);
      toast.error(err.response?.data?.message || t("Failed to update status"));
    }
  };

  const handlePaymentChange = async (orderId, paymentStatus) => {
    if (!paymentStatus) return;
    const originalRows = [...rows];
    patchRow(orderId, { paymentStatus });
    try {
      await updateOrderPayment(orderId, { paymentStatus });
      toast.success(t("Payment marked {status}", { status: t(PAYMENT_LABEL[paymentStatus]) }));
    } catch (err) {
      setRows(originalRows);
      toast.error(err.response?.data?.message || t("Failed to update payment"));
    }
  };

  if (!rows?.length) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#4b5563" }}>
        {t("No orders found")}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {[
              N_("Order ID"), N_("Table No"), N_("Customer"), N_("Items"), N_("Total"), N_("Type"),
              N_("Status"), N_("Payment"), N_("Time"), !hideAction && N_("Action"),
            ].filter(Boolean).map((h) => (
              <th key={h} style={{
                textAlign: "left", padding: "10px 12px", fontSize: 11, color: "#6b7280",
                borderBottom: "0.5px solid #eee", fontWeight: 500, whiteSpace: "nowrap",
              }}>
                {t(h)}
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
                    <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 400 }}>{t(o.source)}</div>
                  )}
                </td>
                <td style={{ padding: "11px 12px", color: "#d1cfe0" }}>
                  {o.tableNo ? t("Table {n}", { n: o.tableNo }) : "—"}
                </td>
                <td style={{ padding: "11px 12px" }}>
                  <div>{o.user?.name || o.guestName || (o.isGuest ? t("Guest") : "—")}</div>
                  <div style={{ fontSize: 11, color: "#374151" }}>
                    {o.user?.phone || o.guestPhone || "—"}
                  </div>
                </td>
                <td style={{ padding: "11px 12px", fontSize: 12, color: "#6b7280", maxWidth: 160 }}>
                  {o.items?.map((i) => `${localName(i)} ×${fmtNum(i.qty)}`).join(", ")}
                </td>
                <td style={{ padding: "11px 12px", fontWeight: 500 }}>₹{fmtNum(o.total)}</td>
                <td style={{ padding: "11px 12px", fontSize: 12 }}>{t(o.orderType)}</td>
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
                        <option key={p} value={p}>{t(PAYMENT_LABEL[p])}</option>
                      ))}
                      {/* historic orders only — shown, never offered */}
                      {o.paymentStatus === "FAILED" && <option value="FAILED" disabled>{t(PAYMENT_LABEL.FAILED)}</option>}
                    </select>
                  )}
                </td>
                <td style={{ padding: "11px 12px", fontSize: 12, color: "#374151" }}>
                  {fmtTime(o.createdAt)}
                </td>
                {!hideAction && (
                  <td style={{ padding: "11px 12px" }}>
                    {isPending ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button disabled={isBusy} onClick={() => handleConfirm(o)} style={confirmBtnStyle}>
                          {isBusy ? "…" : `✓ ${t("Place")}`}
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
                        <option value="" disabled>{t("Update")}</option>
                        {NEXT_STATUS_OPTIONS.filter((s) => s !== o.status && offersStatus(o, s)).map((s) => (
                          <option key={s} value={s} disabled={needsPaidFirst(o, s)} title={needsPaidFirst(o, s) ? t(PAID_FIRST_HINT) : undefined}>
                            {t(s)}{needsPaidFirst(o, s) ? ` (${t("mark Paid first")})` : ""}
                          </option>
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
