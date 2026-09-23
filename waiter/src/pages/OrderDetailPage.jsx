import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  getOrder, confirmOrder, rejectOrder, updateOrderStatus, addItemsToOrder,
  updateOrderPayment, getCombinedBill, printBill,
} from "../services/orderService.js";
import { getMenu, getMenuCategories } from "../services/menuService.js";
import StatusBadge, { statusColor } from "../components/StatusBadge.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import QtyStepper, { AddButton } from "../components/ui/QtyStepper.jsx";
import { Loader, ErrorState, EmptyState } from "../components/StateViews.jsx";
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
  const [menuItems, setMenuItems] = useState(null); // null = loading
  const [menuCategories, setMenuCategories] = useState([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCategory, setMenuCategory] = useState("");
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
  const canAddItems = ["CONFIRMED","PREPARING","READY","DELIVERED"].includes(order.status);
  const stageIdx = STAGES.indexOf(order.status);

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: "20px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.4 }}>{order.orderId}</div>
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
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5, color: "#fff" }}>
              <span>{it.name} × {it.qty}{it.notes ? <span style={{ color: TEXT_FAINT }}> · "{it.notes}"</span> : ""}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>₹{it.price * it.qty}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px dashed ${GLASS_BORDER}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 800, color: "#fff" }}>
            <span style={{ fontSize: 14 }}>Total</span>
            <span style={{ color: ACCENT, fontSize: 23, fontVariantNumeric: "tabular-nums", letterSpacing: -0.4 }}>₹{order.total}</span>
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
            <PrimaryButton disabled={busy} onClick={handleConfirm} variant="success" style={{ flex: 1 }}>✓ Place Order</PrimaryButton>
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
            width: "100%", maxWidth: 560, margin: "0 auto", maxHeight: "85vh", display: "flex", flexDirection: "column",
            background: "#0C0A14", border: `1px solid ${GLASS_BORDER}`, borderBottom: "none",
            borderRadius: "20px 20px 0 0",
          }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0", flexShrink: 0 }}>
              <span style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
            </div>

            <div style={{ padding: "10px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>Add Items</div>
              <button onClick={() => setShowAdd(false)} aria-label="Close" style={{
                width: 32, height: 32, borderRadius: "50%", border: `1px solid ${GLASS_BORDER}`,
                background: GLASS_BG, color: "#fff", fontSize: 14, cursor: "pointer",
              }}>✕</button>
            </div>

            <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
              <input
                value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Search menu…"
                style={{
                  width: "100%", padding: "11px 15px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
                  fontSize: 14, boxSizing: "border-box", background: GLASS_BG, color: "#fff", fontFamily: "inherit",
                }}
              />
            </div>

            {menuCategories.length > 0 && (
              <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px", flexShrink: 0 }}>
                <Chip active={!menuCategory} onClick={() => setMenuCategory("")}>All</Chip>
                {menuCategories.map((c) => (
                  <Chip key={c.category} active={menuCategory === c.category} onClick={() => setMenuCategory(c.category)}>{c.category}</Chip>
                ))}
              </div>
            )}

            <div style={{ padding: "4px 16px 16px", overflowY: "auto" }}>
              {menuItems === null && <Loader label="Loading menu…" />}
              {menuItems !== null && groupedAddItems.length === 0 && <EmptyState icon="🔎" title="No items found" />}
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
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>{it.name}</div>
                            <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 2 }}>₹{it.price}{outOfStock ? " · Out of stock" : ""}</div>
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
                  {busy ? "Adding…" : `Add ${addItemCount} item${addItemCount > 1 ? "s" : ""} to Order`}
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
