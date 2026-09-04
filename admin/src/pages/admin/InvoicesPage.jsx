import { PRIMARY } from "../../theme.js";
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { getAllOrders } from "../../services/adminService.js";
import api from "../../services/api.js";

const PINK  = PRIMARY;
const CARD  = "#16132a";
const CARD2 = "#1c1830";
const BDR   = "rgba(255,255,255,0.07)";
const T1    = "#f1f0f5";
const T2    = "#9ca3af";
const T3    = "#4b5563";

const STATUS_STYLE = {
  Placed:    { bg:"rgba(56,122,221,0.15)",  color:"#60a5fa" },
  Preparing: { bg:"rgba(186,117,23,0.15)",  color:"#fbbf24" },
  Ready:     { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Delivered: { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Completed: { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" },
  Cancelled: { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
};
const PAY_STYLE = {
  Paid:    { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
  Pending: { bg:"rgba(245,158,11,0.15)",  color:"#fbbf24" },
  Failed:  { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
};
const TYPE_STYLE = {
  Dining:      { bg:"rgba(139,92,246,0.15)", color:"#c4b5fd" },
  "Take Away": { bg:"rgba(59,130,246,0.15)", color:"#93c5fd" },
};

const Badge = ({ label, map }) => {
  const s = map[label] || { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" };
  return <span style={{ background:s.bg, color:s.color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{label}</span>;
};

const StatPill = ({ label, value, color, sub }) => (
  <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:"14px 16px" }}>
    <div style={{ fontSize:11, color:T2, marginBottom:4, fontWeight:500 }}>{label}</div>
    <div style={{ fontSize:20, fontWeight:700, color:color||T1 }}>{value}</div>
    {sub && <div style={{ fontSize:11, color:T3, marginTop:3 }}>{sub}</div>}
  </div>
);

const inp = {
  padding:"9px 12px", borderRadius:8, border:`1px solid ${BDR}`,
  fontSize:13, outline:"none", background:CARD2, color:T1,
  boxSizing:"border-box",
};
const CustomerDuesSummary = ({ invoices, PINK, CARD2, BDR, T1, T2, T3, onPaymentChange }) => {
  const [selectedInvoices, setSelectedInvoices] = React.useState({});
  const [payingFor, setPayingFor] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
 
  const customerMap = {};
  
  invoices.forEach(inv => {
    const customerName = inv.guestName || inv.user?.name || "Guest";
    if (!customerMap[customerName]) {
      customerMap[customerName] = {
        name: customerName,
        invoices: [],
        totalDue: 0,
        phone: inv.guestPhone || inv.user?.phone || null,
      };
    }
    customerMap[customerName].invoices.push(inv);
    customerMap[customerName].totalDue += Number(inv.total || 0);
  });
 
  const customers = Object.values(customerMap).sort((a, b) => b.totalDue - a.totalDue);
 
  if (customers.length === 0) return null;
 
  // ─────────────────────────────────────────────────────────────────────────
  // FILTER: Only show invoices that are Pending or Failed (not Paid)
  // ─────────────────────────────────────────────────────────────────────────
  const getPendingInvoices = (customer) => {
    return customer.invoices.filter(inv => 
      inv.paymentStatus === "Pending" || inv.paymentStatus === "Failed"
    );
  };
 
  const toggleInvoice = (customerId, invoiceId) => {
    const key = `${customerId}_${invoiceId}`;
    setSelectedInvoices(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };
 
  const selectAllForCustomer = (customerId, customer) => {
    const pendingInvoices = getPendingInvoices(customer);
    const newSelected = { ...selectedInvoices };
    pendingInvoices.forEach(inv => {
      const key = `${customerId}_${inv._id}`;
      newSelected[key] = true;
    });
    setSelectedInvoices(newSelected);
  };
 
  const deselectAllForCustomer = (customerId, customer) => {
    const pendingInvoices = getPendingInvoices(customer);
    const newSelected = { ...selectedInvoices };
    pendingInvoices.forEach(inv => {
      const key = `${customerId}_${inv._id}`;
      delete newSelected[key];
    });
    setSelectedInvoices(newSelected);
  };
 
  const getSelectedForCustomer = (customerId, customer) => {
    const pendingInvoices = getPendingInvoices(customer);
    return pendingInvoices.filter(inv => {
      const key = `${customerId}_${inv._id}`;
      return selectedInvoices[key];
    });
  };
 
  const getSelectedTotal = (customerId, customer) => {
    const selected = getSelectedForCustomer(customerId, customer);
    return selected.reduce((s, inv) => s + Number(inv.total || 0), 0);
  };
 
  const handlePaySelected = async (customerId, customer) => {
    const selected = getSelectedForCustomer(customerId, customer);
    if (selected.length === 0) {
      return;
    }
 
    setLoading(true);
    setPayingFor(customer.name);
 
    try {
      const payPromises = selected.map(inv =>
        onPaymentChange(inv._id, { paymentStatus: "Paid" })
      );
      
      await Promise.all(payPromises);
      
      deselectAllForCustomer(customerId, customer);
    } catch (error) {
      console.error('Payment error:', error);
    } finally {
      setLoading(false);
      setPayingFor(null);
    }
  };
 
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
        Customer-wise pending dues
      </div>
 
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {customers.map((customer, customerId) => {
          // ─────────────────────────────────────────────────────────────────
          // Get ONLY pending/failed invoices for display
          // ─────────────────────────────────────────────────────────────────
          const pendingInvoices = getPendingInvoices(customer);
          const selectedCount = getSelectedForCustomer(customerId, customer).length;
          const selectedTotal = getSelectedTotal(customerId, customer);
          const pendingTotal = pendingInvoices.reduce((s, inv) => s + Number(inv.total || 0), 0);
 
          // ─────────────────────────────────────────────────────────────────
          // Skip card if customer has NO pending invoices
          // ─────────────────────────────────────────────────────────────────
          if (pendingInvoices.length === 0) {
            return null;
          }
 
          return (
            <div key={customer.name} style={{ background: CARD2, border: `1px solid ${BDR}`, borderRadius: 12, padding: 16 }}>
              {/* Customer header */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T1 }}>
                      {customer.name}
                    </div>
                    {customer.phone && (
                      <div style={{ fontSize: 11, color: T2, marginTop: 2 }}>
                        +91 {customer.phone}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {/* Show ONLY pending amount */}
                    <div style={{ fontSize: 20, fontWeight: 700, color: PINK }}>
                      ₹{Math.round(pendingTotal).toLocaleString("en-IN")}
                    </div>
                    <div style={{ fontSize: 11, color: T2, marginTop: 2 }}>
                      {pendingInvoices.length} pending
                    </div>
                  </div>
                </div>
              </div>
 
              {/* Invoices with checkboxes - ONLY for Pending/Failed */}
              <div style={{ borderTop: `1px solid ${BDR}`, paddingTop: 10, marginBottom: 12 }}>
                {pendingInvoices.map((inv, idx) => {
                  const key = `${customerId}_${inv._id}`;
                  const isSelected = selectedInvoices[key];
 
                  return (
                    <div
                      key={inv._id}
                      onClick={() => toggleInvoice(customerId, inv._id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 0",
                        cursor: "pointer",
                        borderBottom: idx < pendingInvoices.length - 1 ? `0.5px solid ${BDR}` : "none",
                        background: isSelected ? `${PINK}08` : "transparent",
                        paddingLeft: 8,
                        borderRadius: 6,
                        marginLeft: -8,
                        paddingRight: 8,
                        marginRight: -8,
                        transition: "all .15s",
                      }}
                    >
                      {/* Checkbox */}
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: `1.5px solid ${isSelected ? PINK : BDR}`,
                          background: isSelected ? PINK : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "all .15s",
                        }}
                      >
                        {isSelected && (
                          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>
                        )}
                      </div>
 
                      {/* Invoice details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 500, color: T1, fontSize: 12 }}>
                            {inv.orderId}
                          </span>
                          <span style={{ fontWeight: 600, color: isSelected ? PINK : T1, fontSize: 12 }}>
                            ₹{Math.round(inv.total)}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: T3, marginTop: 2 }}>
                          {inv.items?.map(i => `${i.name} ×${i.qty}`).join(", ")}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
 
              {/* Selection summary - only show if something selected */}
              {selectedCount > 0 && (
                <div style={{ background: `${PINK}08`, borderRadius: 8, padding: 10, marginBottom: 12, border: `1px solid ${PINK}33` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: T2 }}>Selected {selectedCount}</span>
                    <span style={{ color: PINK, fontWeight: 700 }}>₹{selectedTotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
                    <button
                      onClick={() => selectAllForCustomer(customerId, customer)}
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `0.5px solid ${PINK}44`,
                        background: "transparent",
                        color: PINK,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      All
                    </button>
                    <button
                      onClick={() => deselectAllForCustomer(customerId, customer)}
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `0.5px solid ${BDR}`,
                        background: "transparent",
                        color: T2,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
 
              {/* Payment buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                {/* Pay selected button */}
                <button
                  disabled={selectedCount === 0 || loading}
                  onClick={() => handlePaySelected(customerId, customer)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: "none",
                    background:
                      selectedCount === 0 || loading
                        ? "#374151"
                        : `linear-gradient(135deg, ${PINK}, #5b21b6)`,
                    color: selectedCount === 0 || loading ? T3 : "#fff",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: selectedCount === 0 || loading ? "not-allowed" : "pointer",
                    transition: "all .15s",
                  }}
                >
                  {loading && payingFor === customer.name ? "Paying…" : `Pay · ₹${selectedTotal}`}
                </button>
 
                {/* Pay all button */}
                <button
                  disabled={loading}
                  onClick={() => {
                    selectAllForCustomer(customerId, customer);
                    setTimeout(() => handlePaySelected(customerId, customer), 0);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: `1px solid ${PINK}44`,
                    background: `${PINK}08`,
                    color: PINK,
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: loading ? "not-allowed" : "pointer",
                    transition: "all .15s",
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  {loading && payingFor === customer.name ? "…" : `All · ₹${pendingTotal}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
 
// export default CustomerDuesSummary;

export default function InvoicesPage() {
  const [orders,    setOrders]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [payFilter, setPayFilter] = useState("All");
  const [typeFilter,setTypeFilter]= useState("All");
  const [expanded,  setExpanded]  = useState(null);
  const [updating,  setUpdating]  = useState(null); // order._id being updated

  useEffect(()=>{
    getAllOrders({ limit:500 })
      .then(r=>{ setOrders(r.data?.orders||[]); setLoading(false); })
      .catch(()=>{ toast.error("Failed to load invoices"); setLoading(false); });
  },[]);

  // ── Payment status update ─────────────────────────────────────────────────
  const handlePaymentChange = async (orderId, data) => {
    setUpdating(orderId);
    try {
      await api.patch(`/admin/orders/${orderId}/payment`, data);
      setOrders(prev => prev.map(o => o._id===orderId ? {...o,...data} : o));
      toast.success("Payment updated ✓");
    } catch { toast.error("Update failed"); }
    finally { setUpdating(null); }
  };

  // Only completed or paid orders show as invoices
  const invoiceOrders = orders.filter(o =>
    o.status==="Completed" || o.paymentStatus==="Paid"
  );

  const filtered = invoiceOrders.filter(o => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      o.orderId?.toLowerCase().includes(q) ||
      o.user?.name?.toLowerCase().includes(q) ||
      o.guestName?.toLowerCase().includes(q) ||
      o.user?.phone?.includes(q) ||
      o.guestPhone?.includes(q);
    const matchPay  = payFilter==="All"  || o.paymentStatus===payFilter;
    const matchType = typeFilter==="All" || o.orderType===typeFilter;
    return matchSearch && matchPay && matchType;
  });

  // Stats
  const completedPaid = invoiceOrders.filter(o=>o.status==="Completed"&&o.paymentStatus==="Paid");
  const totalRevenue  = completedPaid.reduce((s,o)=>s+Number(o.total||0),0);
  const paidCount     = completedPaid.length;
  const pendingCount  = invoiceOrders.filter(o=>o.paymentStatus==="Pending").length;
  const avgVal        = paidCount ? Math.round(totalRevenue/paidCount) : 0;
  const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

  return (
    <div style={{ padding:28, fontFamily:"'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>Invoices</h1>
        <div style={{ fontSize:13, color:T2, marginTop:4 }}>Generated bills and receipts</div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
        <StatPill label="Total invoices"   value={invoiceOrders.length}              />
        <StatPill label="Total collected"  value={`₹${fmt(totalRevenue)}`} color={PINK}     />
        <StatPill label="Paid & Complete"  value={paidCount}              color="#34d399"   />
        <StatPill label="Pending payment"  value={pendingCount}           color="#fbbf24"   />
      </div>

      {/* Filters */}
      <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:16, marginBottom:16 }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by order ID, customer or phone…"
            style={{ ...inp, flex:1, minWidth:220 }}/>
          <select value={payFilter} onChange={e=>setPayFilter(e.target.value)}
            style={{ ...inp, width:"auto", cursor:"pointer" }}>
            <option value="All">All payments</option>
            <option>Paid</option>
            <option>Pending</option>
            <option>Failed</option>
          </select>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}
            style={{ ...inp, width:"auto", cursor:"pointer" }}>
            <option value="All">All types</option>
            <option value="Dining">Dining</option>
            <option value="Take Away">Take Away</option>
          </select>
        </div>
        {(search||payFilter!=="All"||typeFilter!=="All") && (
          <div style={{ marginTop:10, fontSize:12, color:T2 }}>
            Showing <span style={{ fontWeight:600, color:PINK }}>{filtered.length}</span> of {invoiceOrders.length} invoices
            <span onClick={()=>{ setSearch(""); setPayFilter("All"); setTypeFilter("All"); }}
              style={{ color:PINK, cursor:"pointer", marginLeft:10 }}>Clear filters</span>
          </div>
        )}
      </div>

      {/* Table */}
            {/* Show customer dues if filters applied */}
   {(search || payFilter !== "All" || typeFilter !== "All") && filtered.length > 0 && (
  <CustomerDuesSummary
    invoices={filtered}
    PINK={PINK}
    CARD2={CARD2}
    BDR={BDR}
    T1={T1}
    T2={T2}
    T3={T3}
    onPaymentChange={handlePaymentChange}  // ← Pass your payment handler
  />
)}
      <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:18 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:48, color:T3 }}>Loading…</div>
        ) : filtered.length===0 ? (
          <div style={{ textAlign:"center", padding:48 }}>
            <div style={{ fontSize:30, marginBottom:8 }}>📭</div>
            <div style={{ fontSize:14, color:T2 }}>No invoices match your filters</div>
          </div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr>
                  {["Order ID","Customer","Items","Amount","Type","Order Status","Payment","Date",""].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"9px 12px", fontSize:11,
                      color:T2, fontWeight:600, letterSpacing:0.5,
                      borderBottom:`1px solid ${BDR}`, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv=>{
                  const isOpen = expanded===inv._id;
                  const subtotal = inv.items?.reduce((s,i)=>s+i.price*i.qty,0)||0;
                  const tax = inv.tax||0;
                  const sc  = inv.serviceCharge||0;
                  const displayName  = inv.guestName||inv.user?.name || "Guest";
                  const displayPhone =  inv.guestPhone ||inv.user?.phone || null;

                  return (
                    <>
                      <tr key={inv._id} style={{
                        borderBottom: isOpen?"none":`1px solid rgba(255,255,255,0.05)`,
                        background:   isOpen?`${PINK}05`:"transparent",
                        transition:"background .15s",
                      }}
                        onMouseEnter={e=>!isOpen&&(e.currentTarget.style.background="rgba(139,92,246,0.04)")}
                        onMouseLeave={e=>!isOpen&&(e.currentTarget.style.background="transparent")}
                      >
                        {/* Order ID */}
                        <td style={{ padding:"12px", fontWeight:600, color:PINK, whiteSpace:"nowrap" }}>{inv.orderId}</td>

                        {/* Customer */}
                        <td style={{ padding:"12px" }}>
                          <div style={{ fontWeight:500, color:T1 }}>{displayName}</div>
                          <div style={{ fontSize:11, color:T3 }}>{displayPhone?`+91 ${displayPhone}`:"—"}</div>
                        </td>

                        {/* Items */}
                        <td style={{ padding:"12px", fontSize:12, color:T2, maxWidth:160 }}>
                          <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                            {inv.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")||"—"}
                          </div>
                        </td>

                        {/* Amount */}
                        <td style={{ padding:"12px", fontWeight:600, color:T1, whiteSpace:"nowrap" }}>
                          ₹{Math.round(inv.total)}
                        </td>

                        {/* Type */}
                        <td style={{ padding:"12px" }}>
                          <Badge label={inv.orderType||"—"} map={TYPE_STYLE}/>
                        </td>

                        {/* Order Status */}
                        <td style={{ padding:"12px" }}>
                          <Badge label={inv.status} map={STATUS_STYLE}/>
                        </td>

                        {/* Payment */}
                        <td style={{ padding:"12px" }}>
                          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                            <Badge label={inv.paymentStatus} map={PAY_STYLE}/>
                            <span style={{ fontSize:10, color:T3 }}>{inv.paymentMethod||"Cash"}</span>
                          </div>
                        </td>

                        {/* Date */}
                        <td style={{ padding:"12px", fontSize:12, color:T3, whiteSpace:"nowrap" }}>
                          {inv.createdAt
                            ? new Date(inv.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})
                            : "—"}
                        </td>

                        {/* View button */}
                        <td style={{ padding:"12px" }}>
                          <button onClick={()=>setExpanded(isOpen?null:inv._id)} style={{
                            padding:"5px 12px", borderRadius:8, fontSize:12, cursor:"pointer",
                            border:`1px solid ${isOpen?PINK:BDR}`,
                            background:isOpen?`${PINK}15`:CARD2,
                            color:isOpen?PINK:T1, whiteSpace:"nowrap",
                          }}>
                            {isOpen?"Close ↑":"View ↓"}
                          </button>
                        </td>
                      </tr>

                      {/* ── Expanded receipt row ── */}
                      {isOpen && (
                        <tr key={`${inv._id}-detail`} style={{ borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
                          <td colSpan={9} style={{ padding:"4px 12px 20px" }}>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, maxWidth:700 }}>

                              {/* LEFT — receipt */}
                              <div style={{ background:CARD2, borderRadius:12, padding:16,
                                border:`1px solid rgba(139,92,246,0.15)` }}>
                                <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                                  textTransform:"uppercase", marginBottom:12 }}>
                                  Receipt — {inv.orderId}
                                </div>

                                {/* Items */}
                                {inv.items?.map((item,i)=>(
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
                                <div style={{ borderTop:`1px solid ${BDR}`, marginTop:10, paddingTop:10 }}>
                                  {[
                                    { label:"Subtotal",       val:`₹${subtotal}` },
                                    ...(tax>0?[{ label:"GST",            val:`₹${tax}` }]:[]),
                                    ...(sc>0 ?[{ label:"Service Charge", val:`₹${sc}`  }]:[]),
                                  ].map(r=>(
                                    <div key={r.label} style={{ display:"flex", justifyContent:"space-between",
                                      fontSize:12, color:T2, marginBottom:5 }}>
                                      <span>{r.label}</span><span>{r.val}</span>
                                    </div>
                                  ))}
                                  <div style={{ display:"flex", justifyContent:"space-between",
                                    fontWeight:700, fontSize:15, marginTop:8 }}>
                                    <span style={{ color:T1 }}>Total</span>
                                    <span style={{ color:PINK }}>₹{Math.round(inv.total)}</span>
                                  </div>
                                </div>

                                {/* Order info */}
                                <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${BDR}` }}>
                                  {[
                                    { l:"Customer",  v:displayName },
                                    { l:"Phone",     v:displayPhone?`+91 ${displayPhone}`:"—" },
                                    { l:"Type",      v:inv.orderType },
                                    { l:"Table",     v:inv.tableNo?`T${inv.tableNo}`:"—" },
                                    { l:"Method",    v:inv.paymentMethod||"Cash" },
                                  ].map(r=>(
                                    <div key={r.l} style={{ display:"flex", justifyContent:"space-between",
                                      padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)`, fontSize:12 }}>
                                      <span style={{ color:T2 }}>{r.l}</span>
                                      <span style={{ color:T1, fontWeight:500 }}>{r.v}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* RIGHT — payment controls */}
                              <div style={{ background:CARD2, borderRadius:12, padding:16,
                                border:`1px solid rgba(139,92,246,0.15)` }}>

                                {/* Current payment status */}
                                <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                                  textTransform:"uppercase", marginBottom:12 }}>Current Payment</div>
                                <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                                  <Badge label={inv.paymentStatus} map={PAY_STYLE}/>
                                  <span style={{ fontSize:12, color:T2, alignSelf:"center" }}>{inv.paymentMethod||"Cash"}</span>
                                </div>

                                {/* ── Payment Status change ── */}
                                <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                                  textTransform:"uppercase", marginBottom:10 }}>Update Payment Status</div>
                                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                                  {["Pending","Paid","Failed"].map(s=>{
                                    const st  = PAY_STYLE[s];
                                    const active = inv.paymentStatus===s;
                                    const busy   = updating===inv._id;
                                    return (
                                      <button key={s}
                                        disabled={active||busy}
                                        onClick={()=>handlePaymentChange(inv._id,{ paymentStatus:s })}
                                        style={{
                                          padding:"8px 16px", borderRadius:20, fontSize:12,
                                          fontWeight:600, cursor:active||busy?"default":"pointer",
                                          border:`1px solid ${active?st.color+"88":st.color+"44"}`,
                                          background:active?st.bg:"transparent",
                                          color:st.color,
                                          opacity:active?1:busy?0.4:0.7,
                                          transition:"all .15s",
                                        }}
                                        onMouseEnter={e=>{ if(!active&&!busy) e.currentTarget.style.background=st.bg; e.currentTarget.style.opacity="1"; }}
                                        onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; if(!active&&!busy) e.currentTarget.style.opacity="0.7"; }}
                                      >
                                        {active?"✓ ":busy?"…":""}{s}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* ── Payment Method change ── */}
                                <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                                  textTransform:"uppercase", marginBottom:10 }}>Update Payment Method</div>
                                <div style={{ display:"flex", gap:8 }}>
                                  {["Cash","Online"].map(m=>{
                                    const active = (inv.paymentMethod||"Cash")===m;
                                    const busy   = updating===inv._id;
                                    return (
                                      <button key={m}
                                        disabled={active||busy}
                                        onClick={()=>handlePaymentChange(inv._id,{ paymentMethod:m })}
                                        style={{
                                          flex:1, padding:"9px 0", borderRadius:10, fontSize:13,
                                          fontWeight:600, cursor:active||busy?"default":"pointer",
                                          border:`2px solid ${active?PINK:BDR}`,
                                          background:active?`${PINK}15`:CARD,
                                          color:active?PINK:T2,
                                          transition:"all .15s",
                                        }}>
                                        {m==="Cash"?"💵 Cash":"📱 Online"}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Quick actions */}
                                {inv.paymentStatus==="Pending" && (
                                  <div style={{ marginTop:16 }}>
                                    <button
                                      disabled={updating===inv._id}
                                      onClick={()=>handlePaymentChange(inv._id,{ paymentStatus:"Paid" })}
                                      style={{
                                        width:"100%", padding:"11px", borderRadius:10,
                                        background:"rgba(16,185,129,0.2)", color:"#34d399",
                                        border:"1px solid rgba(16,185,129,0.3)",
                                        fontWeight:700, cursor:"pointer", fontSize:13,
                                        opacity:updating===inv._id?0.5:1,
                                      }}>
                                      {updating===inv._id?"Updating…":"✓ Mark as Paid"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}