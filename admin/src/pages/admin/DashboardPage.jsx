import { PRIMARY } from "../../theme.js";
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  updateOrderStatus, getAllOrders, getAllInvoices,
  updateInvoiceStatus, getAllTables,
} from "../../services/adminService.js";

const PINK = PRIMARY;

// ── Dark theme tokens ─────────────────────────────────────────────────────────
const BG      = "#0d0b14";
const CARD    = "#16132a";
const CARD2   = "#1c1830";
const BORDER  = "rgba(255,255,255,0.07)";
const T1      = "#f1f0f5";
const T2      = "#9ca3af";
const T3      = "#4b5563";

// ── Status styles (dark-friendly) ─────────────────────────────────────────────
const STATUS_STYLE = {
  Placed:    { bg: "rgba(56,122,221,0.18)",  color: "#60a5fa",  label: "Placed"    },
  Preparing: { bg: "rgba(186,117,23,0.18)",  color: "#fbbf24",  label: "Preparing" },
  Ready:     { bg: "rgba(29,158,117,0.18)",  color: "#34d399",  label: "Ready"     },
  Delivered: { bg: "rgba(29,158,117,0.18)",  color: "#34d399",  label: "Delivered" },
  Completed: { bg: "rgba(107,114,128,0.18)", color: "#9ca3af",  label: "Completed" },
  Cancelled: { bg: "rgba(239,68,68,0.18)",   color: "#f87171",  label: "Cancelled" },
};

const TYPE_STYLE = {
  Dining:      { bg: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
  "Take Away": { bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
};

const AVATAR_COLORS = [
  { bg: "rgba(139,92,246,0.2)", c: "#c4b5fd" },
  { bg: "rgba(16,185,129,0.2)", c: "#6ee7b7" },
  { bg: "rgba(59,130,246,0.2)", c: "#93c5fd" },
  { bg: "rgba(245,158,11,0.2)", c: "#fcd34d" },
  { bg: "rgba(239,68,68,0.2)",  c: "#fca5a5" },
  { bg: "rgba(236,72,153,0.2)", c: "#f9a8d4" },
];

// ── inject styles ─────────────────────────────────────────────────────────────
if (!document.getElementById("dash-styles")) {
  const s = document.createElement("style");
  s.id = "dash-styles";
  s.textContent = `
    @keyframes dashBlink {
      0%,100%{ box-shadow:0 0 0 0 rgba(211,47,47,0); }
      50%{ box-shadow:0 0 0 4px rgba(211,47,47,0.3); }
    }
    .dash-blink{ animation:dashBlink 1.4s ease-in-out infinite; }
    @keyframes spin { to{ transform:rotate(360deg) } }
  `;
  document.head.appendChild(s);
}

// ── helpers ───────────────────────────────────────────────────────────────────
const isToday = (d) => {
  const dt = new Date(d), n = new Date();
  return dt.getFullYear()===n.getFullYear() && dt.getMonth()===n.getMonth() && dt.getDate()===n.getDate();
};
const initials = (n) => !n||n==="Guest" ? "G"
  : n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const avatarColor = (s) => AVATAR_COLORS[(s?.charCodeAt(0)||0) % AVATAR_COLORS.length];
const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

// ── Small badge ───────────────────────────────────────────────────────────────
const Badge = ({ label, map }) => {
  const s = map[label] || { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "2px 9px", borderRadius: 20,
      fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
    }}>{label}</span>
  );
};

// ── Stat card — matches screenshot exactly ────────────────────────────────────
const StatCard = ({ label, value, sub, color, icon }) => (
  <div style={{
    background: CARD, borderRadius: 14,
    border: `1px solid ${BORDER}`, padding: "18px 20px",
    position: "relative", overflow: "hidden",
  }}>
    {/* glow */}
    <div style={{
      position: "absolute", top: 0, right: 0,
      width: 20, height: 20,
      background: `radial-gradient(circle, ${color||PINK}22, transparent)`,
      borderRadius: "0 14px 0 70px",
    }} />
    {/* icon circle */}
    <div style={{
      width: 38, height: 38, borderRadius: 10, marginBottom: 12,
      background: `${color||PINK}20`,
      border: `1px solid ${color||PINK}33`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 17,
    }}>{icon}</div>
    <div style={{ fontSize: 11, color: T2, marginBottom: 5, fontWeight: 500 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: color||T1, letterSpacing: -0.5 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T3, marginTop: 4 }}>{sub}</div>}
  </div>
);

// ── Status summary grid ───────────────────────────────────────────────────────
function StatusSummary({ orders }) {
  const counts = {};
  orders.forEach(o => {
    if (!counts[o.status]) counts[o.status] = { count:0, revenue:0 };
    counts[o.status].count++;
    counts[o.status].revenue += Number(o.total||0);
  });
  const total = { count: orders.length, revenue: orders.reduce((s,o)=>s+Number(o.total||0),0) };

  const cells = [
    ...["Placed","Preparing","Ready","Delivered","Completed","Cancelled"].map(st => ({
      label: st,
      ...(counts[st]||{count:0,revenue:0}),
      style: STATUS_STYLE[st]||{ bg:"rgba(107,114,128,0.15)", color:"#9ca3af" },
    })),
    { label:"Total", count:total.count, revenue:total.revenue,
      style:{ bg:"rgba(139,92,246,0.12)", color:"#c4b5fd" } },
  ];

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:20 }}>
      {cells.map(c => (
        <div key={c.label} style={{
          background: c.style.bg, borderRadius:10, padding:"10px 12px", textAlign:"center",
        }}>
          <div style={{ fontSize:11, color:c.style.color, fontWeight:600, marginBottom:4 }}>{c.label}</div>
          <div style={{ fontSize:22, fontWeight:700, color:c.style.color }}>{c.count}</div>
          <div style={{ fontSize:10, color:c.style.color, opacity:0.75, marginTop:2 }}>
            ₹{fmt(c.revenue)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live table map ────────────────────────────────────────────────────────────
function TableMap({ orders, invoiceMap, onStatusChange, onInvoiceStatusChange }) {
  const [activeTable, setActiveTable] = useState(null);
  const [tables, setTables] = useState([]);

  useEffect(() => {
    getAllTables().then(r => setTables(r.data?.tables||[])).catch(()=>setTables([]));
  }, []);

  const tableOrderMap = {};
  orders.filter(o => o.orderType==="Dining"&&o.tableNo&&!["Completed","Cancelled"].includes(o.status))
    .forEach(o => { tableOrderMap[Number(o.tableNo)] = o; });

  const selOrder = activeTable ? tableOrderMap[activeTable]||null : null;
  const selInv   = activeTable ? invoiceMap[activeTable]||null : null;
  const isPending= selInv?.invoiceStatus?.toLowerCase()==="pending";

  return (
    <div>
      {/* Grid */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
        {tables.length===0 ? (
          <div style={{ color:T3, fontSize:12, padding:"16px 0" }}>Loading tables…</div>
        ) : (
          tables.filter(t=>t.status==="Active"||!t.status)
            .sort((a,b)=>a.tableNo-b.tableNo)
            .map(t => {
              const o = tableOrderMap[t.tableNo];
              const inv = invoiceMap[t.tableNo];
              const pend = inv?.invoiceStatus?.toLowerCase()==="pending";
              const st = o ? (pend ? {bg:"rgba(211,47,47,0.15)",color:"#f87171"} : STATUS_STYLE[o.status]||{bg:"rgba(107,114,128,0.15)",color:"#9ca3af"}) : {bg:"rgba(255,255,255,0.04)",color:"#6b7280"};
              const isActive = activeTable===t.tableNo;
              return (
                <div key={t.tableNo}
                  className={pend?"dash-blink":""}
                  onClick={()=>setActiveTable(isActive?null:t.tableNo)}
                  style={{
                    borderRadius:8, padding:"8px 14px", cursor:"pointer",
                    background: st.bg,
                    border: isActive ? `2px solid ${PINK}` : `1px solid ${pend?"#f87171":"rgba(255,255,255,0.08)"}`,
                    minWidth:80, textAlign:"center",
                    transition:"all .12s",
                  }}
                >
                  <div style={{ fontSize:13, fontWeight:600, color:st.color }}>T{t.tableNo}</div>
                  <div style={{ fontSize:10, color:st.color, marginTop:2 }}>
                    {pend ? "Pay Due" : o ? o.status : "Free"}
                  </div>
                </div>
              );
            })
        )}
      </div>

      {/* Inline drawer */}
      {activeTable && (
        <div style={{
          marginTop:12, background:CARD2, borderRadius:10,
          border:`1px solid ${isPending?"rgba(239,68,68,0.3)":BORDER}`,
          padding:14,
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div>
              <span style={{ fontWeight:600, fontSize:14, color:T1 }}>Table {activeTable}</span>
              {selOrder && (
                <span style={{ fontSize:11, color:T3, marginLeft:8 }}>
                  {selOrder.orderId} · {selOrder.user?.name||"Guest"}
                </span>
              )}
              {isPending && (
                <span style={{ marginLeft:8, background:"rgba(239,68,68,0.15)", color:"#f87171",
                  fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20 }}>
                  Invoice Pending
                </span>
              )}
            </div>
            <button onClick={()=>setActiveTable(null)} style={{
              width:26, height:26, borderRadius:"50%", border:`1px solid ${BORDER}`,
              background:CARD, cursor:"pointer", color:T2, fontSize:13,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>✕</button>
          </div>

          {!selOrder ? (
            <div style={{ color:T3, fontSize:13, textAlign:"center", padding:"16px 0" }}>
              This table is free — no active order
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              {/* Items */}
              <div>
                <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Items</div>
                {selOrder.items?.map((item,i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between",
                    padding:"5px 0", borderBottom:`1px solid ${BORDER}`, fontSize:12 }}>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <div style={{ width:20, height:20, borderRadius:5, background:`${PINK}20`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:11, fontWeight:600, color:PINK }}>
                        {item.qty}
                      </div>
                      <span style={{ color:T1 }}>{item.name}</span>
                    </div>
                    <span style={{ color:T1, fontWeight:500 }}>₹{item.price*item.qty}</span>
                  </div>
                ))}
                <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontWeight:600, fontSize:14, color:isPending?"#f87171":PINK }}>
                    <span style={{ color:T1 }}>Total</span>
                    <span>₹{fmt(selOrder.total)}</span>
                  </div>
                </div>
              </div>
              {/* Actions */}
              <div>
                <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Update order</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12 }}>
                  {["Placed","Preparing","Ready","Delivered","Completed","Cancelled"]
                    .filter(s=>s!==selOrder.status).map(s => {
                      const st = STATUS_STYLE[s]||{bg:"rgba(107,114,128,0.15)",color:"#9ca3af"};
                      return (
                        <button key={s} onClick={()=>{ onStatusChange(selOrder._id,s); setActiveTable(null); }}
                          style={{ padding:"5px 10px", borderRadius:20, fontSize:11, cursor:"pointer",
                            border:`1px solid ${st.color}33`, background:st.bg, color:st.color, fontWeight:500 }}>
                          {s}
                        </button>
                      );
                    })}
                </div>
                {selInv && isPending && (
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>{ onInvoiceStatusChange(selInv._id,"completed"); setActiveTable(null); }}
                      style={{ flex:1, padding:"8px", background:"rgba(16,185,129,0.2)", color:"#34d399",
                        border:"1px solid rgba(16,185,129,0.3)", borderRadius:8, fontWeight:600, cursor:"pointer", fontSize:12 }}>
                      Mark Paid
                    </button>
                    <button onClick={()=>{ onInvoiceStatusChange(selInv._id,"cancelled"); setActiveTable(null); }}
                      style={{ flex:1, padding:"8px", background:"rgba(239,68,68,0.15)", color:"#f87171",
                        border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, fontWeight:600, cursor:"pointer", fontSize:12 }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recent orders panel ───────────────────────────────────────────────────────
function OrderList({ orders, onStatusChange }) {
  const [type, setType] = useState("all");
  const active = orders.filter(o=>!["Completed","Cancelled"].includes(o.status));
  const dining  = active.filter(o=>o.orderType==="Dining");
  const takeaway= active.filter(o=>o.orderType==="Take Away");
  const visible = type==="dining" ? dining : type==="takeaway" ? takeaway : active;

  return (
    <>
      {/* Type filter tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {[
          { key:"all",      label:"All orders", count:active.length,   color:T1 },
          { key:"dining",   label:"Dining",     count:dining.length,   color:PINK },
          { key:"takeaway", label:"Take away",  count:takeaway.length, color:"#60a5fa" },
        ].map(b => (
          <div key={b.key} onClick={()=>setType(b.key)} style={{
            flex:1, textAlign:"center", cursor:"pointer", borderRadius:10,
            padding:"11px 8px",
            border: type===b.key ? `2px solid ${PINK}` : `1px solid ${BORDER}`,
            background: type===b.key ? `${PINK}12` : CARD2,
            transition:"all .15s",
          }}>
            <div style={{ fontSize:20, fontWeight:700, color:b.color }}>{b.count}</div>
            <div style={{ fontSize:11, color:T2, marginTop:3 }}>{b.label}</div>
          </div>
        ))}
      </div>

      {visible.length===0 ? (
        <div style={{ textAlign:"center", padding:"40px 16px", color:T3, fontSize:13 }}>
          No active orders
        </div>
      ) : visible.map(o => {
        const av = avatarColor(o.guestName||o.user?.name||"Guest");
        return (
          <div key={o._id} style={{
            display:"flex", gap:10, alignItems:"flex-start",
            padding:"11px 0", borderBottom:`1px solid ${BORDER}`,
          }}>
            {/* Avatar */}
            <div style={{
              width:34, height:34, borderRadius:"50%",
              background:av.bg, color:av.c,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:12, fontWeight:600, flexShrink:0,
            }}>{initials(o.guestName||o.user?.name)}</div>

            <div style={{ flex:1, minWidth:0 }}>
              {/* Row 1: name + amount */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                <div>
                  <span style={{ fontWeight:600, fontSize:13, color:T1 }}>{o.guestName||o.user?.name||"Admin"}</span>
                  <span style={{ fontSize:11, color:T3, marginLeft:6 }}>{o.orderId}</span>
                </div>
                <span style={{ fontWeight:700, color:PINK, fontSize:14 }}>₹{fmt(o.total)}</span>
              </div>
              {/* Items */}
              <div style={{ fontSize:12, color:T2, marginBottom:6,
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {o.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")}
              </div>
              {/* Badges */}
              <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                <Badge label={o.status} map={STATUS_STYLE} />
                <Badge label={o.orderType} map={TYPE_STYLE} />
                {o.tableNo && (
                  <span style={{ fontSize:11, color:T3,
                    background:"rgba(255,255,255,0.05)", borderRadius:20, padding:"2px 8px" }}>
                    Table {o.tableNo}
                  </span>
                )}
                <span style={{ fontSize:11, color:T3, marginLeft:"auto" }}>
                  {new Date(o.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                </span>
              </div>
              {/* Status update dropdown */}
              <div style={{ marginTop:8 }}>
                <select defaultValue="" onChange={e=>{ if(e.target.value) onStatusChange(o._id,e.target.value); }}
                  style={{ fontSize:11, padding:"5px 10px", borderRadius:8,
                    border:`1px solid ${BORDER}`, background:CARD, color:T2, cursor:"pointer" }}>
                  <option value="" disabled>Update status…</option>
                  {["Placed","Preparing","Ready","Delivered","Completed","Cancelled"]
                    .filter(s=>s!==o.status).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage({ data }) {
  const s = data?.stats || {};

  const [allOrders,      setAllOrders]      = useState([]);
  const [allTodayOrders, setAllTodayOrders] = useState([]);
  const [invoiceMap,     setInvoiceMap]     = useState({});
  const [loading,        setLoading]        = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, invoicesRes] = await Promise.all([
        getAllOrders({ limit:1000 }),
        getAllInvoices().catch(()=>({ data:{ invoices:[] } })),
      ]);
      const full   = ordersRes.data.orders||[];
      const today  = full.filter(o=>isToday(o.createdAt));
      const invoices = invoicesRes.data?.invoices||[];

      const activeDining = today.filter(o=>o.orderType==="Dining"&&o.tableNo&&!["Completed","Cancelled"].includes(o.status));
      const iMap = {};
      invoices.forEach(inv=>{
        const ids = inv.orders?.map(String)||[];
        for(const o of activeDining){
          if(ids.includes(String(o._id))){
            iMap[Number(o.tableNo)] = { ...inv, invoiceStatus: inv.status||inv.paymentStatus||"pending" };
            break;
          }
        }
      });

      setAllOrders(full);
      setAllTodayOrders(today);
      setInvoiceMap(iMap);
    } catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const handleStatusChange = async (id, st) => {
    try {
      await updateOrderStatus(id, st);
      toast.success(`→ ${st}`);
      setAllTodayOrders(p=>p.map(o=>o._id===id?{...o,status:st}:o));
    } catch { toast.error("Update failed"); }
  };

  const handleInvoiceChange = async (id, st) => {
    try {
      await updateInvoiceStatus(id, st);
      toast.success(`Invoice → ${st}`);
      await fetchData();
    } catch { toast.error("Invoice update failed"); }
  };

  // ── Stats calculations ──────────────────────────────────────────────────────
// ── Stats calculations — ALL TIME ──────────────────────────────────────────
const paidOrders    = allOrders.filter(o => o.paymentStatus === "Paid");
const pendingOrders = allOrders.filter(o => o.paymentStatus === "Pending");
const cashPaid      = allOrders.filter(o => o.paymentMethod === "Cash"   && o.paymentStatus === "Paid");
const onlinePaid    = allOrders.filter(o => o.paymentMethod === "Online" && o.paymentStatus === "Paid");

const totalRev      = paidOrders.reduce((s,o) => s + Number(o.total||0), 0);
const totalDue      = pendingOrders.reduce((s,o) => s + Number(o.total||0), 0);
const totalCash     = cashPaid.reduce((s,o) => s + Number(o.total||0), 0);
const totalOnline   = onlinePaid.reduce((s,o) => s + Number(o.total||0), 0);
const avgOrder      = paidOrders.length ? Math.round(totalRev / paidOrders.length) : 0;
const activeTables  = allTodayOrders.filter(o => o.orderType==="Dining" && o.tableNo && !["Completed","Cancelled"].includes(o.status)).length;
const pendingInv    = Object.values(invoiceMap).filter(i => i.invoiceStatus?.toLowerCase()==="pending").length;

// today still needed for today's stat boxes in status summary
const paidToday = allTodayOrders.filter(o => o.paymentStatus === "Paid");
const todayRev  = paidToday.reduce((s,o) => s + Number(o.total||0), 0);

  const today = new Date().toLocaleDateString("en-IN",{ weekday:"long", day:"numeric", month:"long", year:"numeric" });

const STAT_BOXES = [
  { icon:"💰", label:"Total Collected",        value:`₹${fmt(totalRev)}`,      sub:`${paidOrders.length} paid orders`,    color:PINK        },
  { icon:"📦", label:"Total Orders",           value:allOrders.length,          sub:`+${allTodayOrders.length} today`,     color:"#34d399"   },
  { icon:"👥", label:"Registered Users",       value:s.totalUsers||0,           sub:"Guests included",                    color:"#60a5fa"   },
  { icon:"🍽️", label:"Menu Items",             value:s.totalItems||0,           sub:"Available",                          color:"#fbbf24"   },
  { icon:"✅", label:"Total Paid Orders",      value:paidOrders.length,         sub:`₹${fmt(totalRev)}`,                  color:"#34d399"   },
  { icon:"🔴", label:"Total Due",              value:pendingOrders.length,      sub:`₹${fmt(totalDue)}`,                  color:"#f87171"   },
  { icon:"💵", label:"Cash Collected",         value:cashPaid.length,           sub:`₹${fmt(totalCash)}`,                 color:"#fbbf24"   },
  { icon:"📱", label:"Online Collected",       value:onlinePaid.length,         sub:`₹${fmt(totalOnline)}`,               color:"#c4b5fd"   },
];

  return (
    <div style={{ padding:28, fontFamily:"'DM Sans',sans-serif", minHeight:"100vh" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>Dashboard</h1>
          <div style={{ fontSize:13, color:PINK, marginTop:4, fontWeight:500 }}>{today}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {pendingInv>0 && (
            <span className="dash-blink" style={{
              background:"rgba(239,68,68,0.15)", color:"#f87171",
              fontSize:12, fontWeight:600, padding:"5px 13px", borderRadius:20,
              border:"1px solid rgba(239,68,68,0.3)",
            }}>
              {pendingInv} invoice{pendingInv>1?"s":""} pending
            </span>
          )}
          {/* Restaurant pill — matches screenshot top-right */}
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            background:CARD2, border:`1px solid ${BORDER}`,
            borderRadius:20, padding:"7px 14px",
          }}>
            <span style={{ fontSize:15 }}>🏪</span>
            <span style={{ fontSize:13, color:T2 }}>Restaurant:</span>
            <span style={{ fontSize:13, fontWeight:600, color:T1 }}>
              {data?.profile?.restaurantName || "Kolhad Cafe"}
            </span>
            <span style={{ color:T3, fontSize:13 }}>▾</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#34d399" }} />
            <span style={{ fontSize:12, color:"#34d399", fontWeight:500 }}>Live</span>
          </div>
        </div>
      </div>

      {/* ── Stat cards grid (4 × 2) ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:22 }}>
        {STAT_BOXES.map((b,i) => <StatCard key={i} {...b} />)}
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:60, color:T3 }}>
          <div style={{ width:30, height:30, borderRadius:"50%", border:`3px solid ${PINK}22`,
            borderTopColor:PINK, animation:"spin .7s linear infinite", margin:"0 auto 12px" }} />
          Loading…
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.1fr", gap:16 }}>

          {/* ── LEFT ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{
              background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:20,
            }}>
              {/* Section header */}
              <div style={{ fontSize:11, fontWeight:600, color:PINK, letterSpacing:1.5,
                textTransform:"uppercase", marginBottom:14 }}>
                Orders by status — today
              </div>
              <StatusSummary orders={allTodayOrders} />

              {/* Live table map */}
              <div style={{ fontSize:11, fontWeight:600, color:PINK, letterSpacing:1.5,
                textTransform:"uppercase", marginBottom:12 }}>
                Live table map
              </div>
              <TableMap
                orders={allTodayOrders}
                invoiceMap={invoiceMap}
                onStatusChange={handleStatusChange}
                onInvoiceStatusChange={handleInvoiceChange}
              />
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div style={{
            background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:20,
            maxHeight:"80vh", overflowY:"auto",
          }}>
            <div style={{ fontSize:11, fontWeight:600, color:PINK, letterSpacing:1.5,
              textTransform:"uppercase", marginBottom:16 }}>
              Recent orders — today (active only)
            </div>
            <OrderList
              orders={allTodayOrders}
              onStatusChange={handleStatusChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}