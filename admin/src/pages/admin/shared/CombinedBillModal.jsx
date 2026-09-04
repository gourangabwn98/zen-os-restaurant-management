// ═══════════════════════════════════════════════════════════════════════════════
// CombinedBillModal.jsx — Add this component to your OrdersPage.jsx
// Shows a merged bill for same customer or same table across multiple orders
// ═══════════════════════════════════════════════════════════════════════════════

// import { PRIMARY } from "../../../theme.js";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "../../../services/api.js";
import { PRIMARY } from "../../../theme.js";

const PINK  = PRIMARY;
const CARD  = "#16132a";
const CARD2 = "#1c1830";
const BDR   = "rgba(255,255,255,0.07)";
const T1    = "#f1f0f5";
const T2    = "#9ca3af";
const T3    = "#4b5563";
const PAY_STYLE = {
  Paid:    { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Pending: { bg:"rgba(245,158,11,0.15)",  color:"#fbbf24" },
  Failed:  { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
};
const STATUS_STYLE = {
  Placed:    { bg:"rgba(56,122,221,0.15)",  color:"#60a5fa" },
  Preparing: { bg:"rgba(186,117,23,0.15)",  color:"#fbbf24" },
  Ready:     { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Delivered: { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Completed: { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" },
  Cancelled: { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
};
const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

const Badge = ({ label, map }) => {
  const s = map[label] || { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" };
  return <span style={{ background:s.bg, color:s.color, padding:"3px 8px", borderRadius:20, fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{label}</span>;
};

export default function CombinedBillModal({ mode, value, onClose, onPaymentChange }) {
  // mode = "phone" | "table" | "orders"
  // value = phone number | tableNo | comma-separated order IDs
  const [bill, setBill]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const params = {};
    if (mode === "phone")  params.phone   = value;
    if (mode === "table")  params.tableNo = value;
    if (mode === "orders") params.orderIds = value;

    api.get("/admin/orders/combined-bill", { params })
      .then(r => setBill(r.data))
      .catch(err => { toast.error(err.response?.data?.message || "Failed to load bill"); onClose(); })
      .finally(() => setLoading(false));
  }, [mode, value]);

  const handleMarkAllPaid = async () => {
    if (!bill?.orders?.length) return;
    try {
      await Promise.all(bill.orders.map(o =>
        api.patch(`/admin/orders/${o._id}/payment`, { paymentStatus: "Paid" })
      ));
      setBill(prev => ({
        ...prev,
        orders: prev.orders.map(o => ({ ...o, paymentStatus: "Paid" })),
      }));
      if (onPaymentChange) onPaymentChange();
      toast.success("All orders marked Paid ✓");
    } catch { toast.error("Failed to mark paid"); }
  };

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 100);
  };

  if (loading) return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:T1, fontSize:14 }}>Loading combined bill…</div>
    </div>
  );

  if (!bill) return null;

  const allPaid = bill.orders.every(o => o.paymentStatus === "Paid");
  const paidTotal = bill.orders.filter(o=>o.paymentStatus==="Paid").reduce((s,o)=>s+Number(o.total||0),0);
  const dueTotal  = bill.grandTotal - paidTotal;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)" }}>
      <div style={{ background:CARD, borderRadius:18, width:"100%", maxWidth:600,
        maxHeight:"92vh", overflowY:"auto", border:`1px solid rgba(139,92,246,0.25)`,
        boxShadow:"0 25px 60px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"18px 22px", borderBottom:`1px solid ${BDR}` }}>
          <div>
            <div style={{ fontWeight:700, fontSize:17, color:T1 }}>
              🧾 Combined Bill
            </div>
            <div style={{ fontSize:12, color:T2, marginTop:3 }}>
              {bill.orderCount} order{bill.orderCount!==1?"s":""} · {bill.restaurantName}
            </div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={handlePrint} disabled={printing} style={{ padding:"7px 14px", borderRadius:20,
              border:`1px solid ${BDR}`, background:CARD2, color:T2, cursor:"pointer", fontSize:12 }}>
              🖨️ Print
            </button>
            <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%",
              border:`1px solid ${BDR}`, background:CARD2, cursor:"pointer", color:T2, fontSize:14,
              display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        </div>

        <div style={{ padding:"20px 22px" }}>

          {/* Individual orders summary */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
              textTransform:"uppercase", marginBottom:10 }}>Order Breakdown</div>
            {bill.orders.map((o,i) => {
              const name = o.user?.name || o.guestName || `Order ${i+1}`;
              const st   = PAY_STYLE[o.paymentStatus];
              return (
                <div key={o._id} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"9px 12px", borderRadius:8, marginBottom:5,
                  background:CARD2, border:`1px solid ${BDR}` }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:T1 }}>{name}</div>
                    <div style={{ fontSize:11, color:T3, marginTop:2 }}>
                      {o.orderId} · {o.items?.length||0} items
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <Badge label={o.status} map={STATUS_STYLE}/>
                    <Badge label={o.paymentStatus} map={PAY_STYLE}/>
                    <span style={{ fontWeight:700, color:PINK, minWidth:60, textAlign:"right" }}>
                      ₹{fmt(o.total)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Merged items list */}
          <div style={{ background:CARD2, borderRadius:12, padding:16, marginBottom:16 }}>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
              textTransform:"uppercase", marginBottom:12 }}>All Items Combined</div>
            {bill.mergedItems.map((item,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between",
                padding:"7px 0", borderBottom:`1px solid ${BDR}`, fontSize:13 }}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <div style={{ width:24, height:24, borderRadius:6, background:`${PINK}20`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:12, fontWeight:600, color:PINK }}>{item.qty}</div>
                  <span style={{ color:T1 }}>{item.name}</span>
                </div>
                <span style={{ fontWeight:500, color:T1 }}>₹{item.price*item.qty}</span>
              </div>
            ))}

            {/* Totals */}
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${BDR}` }}>
              {[
                { l:"Subtotal",       v:`₹${fmt(bill.subtotal)}` },
                ...(bill.tax>0          ? [{ l:"GST",            v:`₹${fmt(bill.tax)}` }]          : []),
                ...(bill.serviceCharge>0? [{ l:"Service Charge", v:`₹${fmt(bill.serviceCharge)}` }] : []),
              ].map(r => (
                <div key={r.l} style={{ display:"flex", justifyContent:"space-between",
                  fontSize:12, color:T2, marginBottom:5 }}>
                  <span>{r.l}</span><span>{r.v}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between",
                fontWeight:700, fontSize:18, marginTop:10, paddingTop:10, borderTop:`1px solid ${BDR}` }}>
                <span style={{ color:T1 }}>Grand Total</span>
                <span style={{ color:PINK }}>₹{fmt(bill.grandTotal)}</span>
              </div>
              {paidTotal>0 && (
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#34d399", marginTop:5 }}>
                  <span>Paid</span><span>₹{fmt(paidTotal)}</span>
                </div>
              )}
              {dueTotal>0 && (
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:700, color:"#f87171", marginTop:5 }}>
                  <span>Due</span><span>₹{fmt(dueTotal)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {!allPaid && (
            <button onClick={handleMarkAllPaid} style={{ width:"100%", padding:"13px",
              borderRadius:12, border:"none", cursor:"pointer", fontWeight:700, fontSize:14,
              background:"rgba(16,185,129,0.2)", color:"#34d399",
              border:"1px solid rgba(16,185,129,0.3)" }}>
              ✓ Mark All Orders as Paid · ₹{fmt(dueTotal)} Due
            </button>
          )}
          {allPaid && (
            <div style={{ textAlign:"center", padding:"12px", borderRadius:12,
              background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.2)",
              color:"#34d399", fontWeight:600, fontSize:14 }}>
              ✓ All orders fully paid
            </div>
          )}
        </div>
      </div>
    </div>
  );
}