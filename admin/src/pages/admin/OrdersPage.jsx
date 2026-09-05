// import { PRIMARY } from "../../theme.js";
// import { useState, useEffect, useCallback,useMemo  } from "react";
// import toast from "react-hot-toast";
// import {
//   getAllOrders, getRestaurantProfile, updateOrderStatus,
//   getAllTables, updateInvoiceStatus,printOrderBill
// } from "../../services/adminService.js";
// // import { getMenu } from "../../services/menuService.js";
// import { placeOrder } from "../../services/orderService.js";
// import CombinedBillModal from "./shared/CombinedBillModal.jsx";
// import { getMenu, getCategories } from "../../services/menuService.js";

// // ── add this to adminService.js if not already there ─────────────────────────
// // export const updateOrderPayment = (id, data) => api.patch(`/admin/orders/${id}/payment`, data);

// const PINK  = PRIMARY;
// const CARD  = "#16132a";
// const CARD2 = "#1c1830";
// const BDR   = "rgba(255,255,255,0.07)";
// const T1    = "#f1f0f5";
// const T2    = "#9ca3af";
// const T3    = "#4b5563";

// const STATUS_STYLE = {
//   Placed:    { bg:"rgba(56,122,221,0.15)",  color:"#60a5fa" },
//   Preparing: { bg:"rgba(186,117,23,0.15)",  color:"#fbbf24" },
//   Ready:     { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
//   Delivered: { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
//   Completed: { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" },
//   Cancelled: { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
// };
// const PAY_STYLE = {
//   Paid:    { bg:"rgba(16,185,129,0.15)",  color:"#34d399" },
//   Pending: { bg:"rgba(245,158,11,0.15)",  color:"#fbbf24" },
//   Failed:  { bg:"rgba(239,68,68,0.15)",   color:"#f87171" },
// };
// const TYPE_STYLE = {
//   Dining:      { bg:"rgba(139,92,246,0.15)", color:"#c4b5fd" },
//   "Take Away": { bg:"rgba(59,130,246,0.15)", color:"#93c5fd" },
// };
// const STATUSES = ["All","PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"];
// const ACTIVE_ORDER_STATUSES = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
// const AVATAR_COLORS = [
//   { bg:"rgba(139,92,246,0.2)", c:"#c4b5fd" },
//   { bg:"rgba(16,185,129,0.2)", c:"#6ee7b7" },
//   { bg:"rgba(59,130,246,0.2)", c:"#93c5fd" },
//   { bg:"rgba(245,158,11,0.2)", c:"#fcd34d" },
//   { bg:"rgba(239,68,68,0.2)",  c:"#fca5a5" },
//   { bg:"rgba(236,72,153,0.2)", c:"#f9a8d4" },
// ];
// const CATEGORY_ORDER = [
//   "pizza",
//   "burger",
//   "snack",
//   "french fry",
//   "momo",
//   "sandwich",
//   "beverage",
//   "mocktail",
//   "biscuit",
//   "cake",
//   "extra",
// ];

// const normalizeCategory = (s) => (s || "").trim().toLowerCase();

// const getCategoryRank = (cat) => {
//   const n = normalizeCategory(cat);
//   const idx = CATEGORY_ORDER.findIndex((key) => n.includes(key));
//   return idx === -1 ? CATEGORY_ORDER.length : idx; // unknown categories fall to the end
// };
// const avc = (n) => AVATAR_COLORS[(n?.charCodeAt(0)||0) % AVATAR_COLORS.length];
// const ini = (n) => !n||n==="Guest" ? "G" : n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
// const inp = { padding:"9px 12px", borderRadius:8, border:`1px solid ${BDR}`, fontSize:13, outline:"none", background:CARD2, color:T1, width:"100%", boxSizing:"border-box" };
// const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

// // ── Badge ─────────────────────────────────────────────────────────────────────
// const Badge = ({ label, map }) => {
//   const s = map[label] || { bg:"rgba(107,114,128,0.15)", color:"#9ca3af" };
//   return <span style={{ background:s.bg, color:s.color, padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{label}</span>;
// };

// // ── StatPill ──────────────────────────────────────────────────────────────────
// const StatPill = ({ label, value, color, sub, icon }) => (
//   <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:"14px 16px", position:"relative", overflow:"hidden" }}>
//     <div style={{ position:"absolute", top:0, right:0, width:50, height:50, background:`${color||PINK}15`, borderRadius:"0 12px 0 50px" }}/>
//     {icon && <div style={{ fontSize:18, marginBottom:6 }}>{icon}</div>}
//     <div style={{ fontSize:11, color:T2, marginBottom:4, fontWeight:500 }}>{label}</div>
//     <div style={{ fontSize:20, fontWeight:700, color:color||T1 }}>{value}</div>
//     {sub && <div style={{ fontSize:11, color:T3, marginTop:3 }}>{sub}</div>}
//   </div>
// );

// // ── OrderDetail ───────────────────────────────────────────────────────────────
// const OrderDetail = ({ order, onStatusChange, onPaymentChange, onCombinedBill }) => {
//   const subtotal = order.items?.reduce((s,i)=>s+i.price*i.qty,0)||0;
//   const displayName = order.user?.name || order.guestName || "Guest";
//   const displayPhone = order.guestPhone||order.user?.phone  || null;

//   return (
//     <div style={{ background:CARD2, borderRadius:10, padding:16,
//       border:`1px solid rgba(139,92,246,0.15)`,
//       display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
//       gap:16, marginTop:2 }}>

//       {/* Items */}
//       <div>
//         <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Items ordered</div>
//         {order.items?.map((item,i)=>(
//           <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${BDR}`, fontSize:13 }}>
//             <div style={{ display:"flex", gap:10, alignItems:"center" }}>
//               <div style={{ width:24, height:24, borderRadius:6, background:`${PINK}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:600, color:PINK }}>{item.qty}</div>
//               <span style={{ color:T1 }}>{item.name}</span>
//             </div>
//             <span style={{ fontWeight:500, color:T1 }}>₹{item.price*item.qty}</span>
//           </div>
//         ))}
//         <div style={{ borderTop:`1px solid ${BDR}`, marginTop:10, paddingTop:10 }}>
//           {[
//             { l:"Subtotal", v:`₹${subtotal}` },
//             ...(order.serviceCharge>0?[{ l:"Service Charge", v:`₹${order.serviceCharge}` }]:[]),
//             ...(order.tax>0?[{ l:"GST", v:`₹${order.tax}` }]:[]),
//           ].map(r=>(
//             <div key={r.l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2, marginBottom:5 }}>
//               <span>{r.l}</span><span>{r.v}</span>
//             </div>
//           ))}
//           <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:15, marginTop:8 }}>
//             <span style={{ color:T1 }}>Total</span>
//             <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
//           </div>
//         </div>
//       </div>

//       {/* Info + Status + Payment */}
//       <div>
//         <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Order info</div>
//         {[
//           { l:"Order ID", v:order.orderId,                    vc:PINK },
//           { l:"Customer", v:displayName                               },
//           { l:"Phone",    v:displayPhone?`+91 ${displayPhone}`:"—"   },
//           { l:"Type",     v:order.orderType                           },
//           { l:"Table",    v:order.tableNo?`T${order.tableNo}`:"—"    },
//           { l:"Date",     v:new Date(order.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) },
//         ].map(r=>(
//           <div key={r.l} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid rgba(255,255,255,0.05)`, fontSize:13 }}>
//             <span style={{ color:T2 }}>{r.l}</span>
//             <span style={{ fontWeight:500, color:r.vc||T1 }}>{r.v}</span>
//           </div>
//         ))}

//         {/* Order Status update */}
//         <div style={{ marginTop:14 }}>
//           <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Update Order Status</div>
//           <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
//             {["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"]
//               .filter(s=>s!==order.status).map(s=>{
//                 const st=STATUS_STYLE[s]||{ bg:"rgba(107,114,128,0.15)", color:"#9ca3af" };
//                 return <button key={s} onClick={()=>onStatusChange(order._id,s)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${st.color}44`, background:st.bg, color:st.color, cursor:"pointer", fontSize:12, fontWeight:500 }}>{s}</button>;
//               })}
//           </div>
//         </div>

//         {/* Payment Status update */}
//         <div style={{ marginTop:14 }}>
//           <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Payment Status</div>
//           <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
//             {["PENDING_VERIFICATION","PAID","FAILED"].map(s=>{
//               const st=PAY_STYLE[s];
//               const active=order.paymentStatus===s;
//               return (
//                 <button key={s} onClick={()=>!active&&onPaymentChange(order._id,{ paymentStatus:s })}
//                   style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:active?"default":"pointer",
//                     border:`1px solid ${active?st.color+"88":st.color+"44"}`,
//                     background:active?st.bg:"transparent",
//                     color:st.color, opacity:active?1:0.6 }}>
//                   {active?"✓ ":""}{{PENDING_VERIFICATION:"Pending",PAID:"Paid",FAILED:"Failed"}[s]}
//                 </button>
//               );
//             })}
//           </div>
//         </div>

//         {/* Payment Method update */}
//         <div style={{ marginTop:10 }}>
//           <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Payment Method</div>
//           <div style={{ display:"flex", gap:6 }}>
//             {["Cash","Online"].map(m=>{
//               const active=order.paymentMethod===m;
//               return (
//                 <button key={m} onClick={()=>!active&&onPaymentChange(order._id,{ paymentMethod:m })}
//                   style={{ padding:"6px 16px", borderRadius:20, fontSize:12, fontWeight:600, cursor:active?"default":"pointer",
//                     border:`2px solid ${active?PINK:BDR}`,
//                     background:active?`${PINK}15`:CARD2,
//                     color:active?PINK:T2 }}>
//                   {m==="Cash"?"💵":"📱"} {m}
//                 </button>
//               );
//             })}
//           </div>
//         </div>

//          {(order.guestPhone || order.user?.phone) && (
//           <button onClick={()=>onCombinedBill?.("phone", order.guestPhone||order.user?.phone)}
//             style={{ marginTop:12, padding:"7px 14px", borderRadius:20,
//               border:`1px solid ${PINK}44`, background:`${PINK}10`,
//               color:PINK, cursor:"pointer", fontSize:12, fontWeight:600 }}>
//             🧾 View all orders for this customer
//           </button>
//         )}
//       </div>
//     </div>
//   );
// };

// // ── ItemImage ─────────────────────────────────────────────────────────────────
// const isUrl = (s) => typeof s==="string"&&s.startsWith("http");
// const ItemImage = ({ src, name }) => isUrl(src)
//   ? <img src={src} alt={name} onError={e=>e.target.style.display="none"} style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
//   : <span style={{ fontSize:24, flexShrink:0 }}>{src||"🍽️"}</span>;

// // ── CreateOrderModal ──────────────────────────────────────────────────────────
// // ── CreateOrderModal — KFC-style rush ordering ────────────────────────────────
// const CreateOrderModal = ({ onClose, onCreated }) => {
//   const [vegFilter,  setVegFilter]  = useState("All");
//   const [tempFilter, setTempFilter] = useState("All");
//   const [mi,          setMi]          = useState([]);
//   const [selCat,      setSelCat]      = useState("All");
//   const [search,      setSearch]      = useState("");
//   const [cart,        setCart]        = useState([]);
//   const [orderType,   setOrderType]   = useState("Dining");
//   const [tableNo,     setTableNo]     = useState("");
//   const [customerName,setCustomerName]= useState("");
//   const [customerPhone,setCustomerPhone]=useState("");
//   const [paymentMethod,setPaymentMethod]=useState("Cash");
//   const [paymentStatus,setPaymentStatus]=useState("Pending");
//   const [loading,     setLoading]     = useState(false);
//   const [menuLoading, setMenuLoading] = useState(true);
//   const [scpi,        setScpi]        = useState(0);
//   const [gstRate,     setGstRate]     = useState(0);
//   const [catImages, setCatImages] = useState({});

//   useEffect(()=>{
//     getMenu({}).then(r=>{ setMi(r.data||[]); setMenuLoading(false); }).catch(()=>setMenuLoading(false));
//     getRestaurantProfile().then(r=>{ const p=r.data?.data||r.data; setScpi(p?.serviceCharge||0); setGstRate(p?.gstRate||0); }).catch(()=>{});
//     getCategories().then(r=>{
//       const list = r.data?.data || r.data || [];
//       const map = {};
//       list.forEach(c=>{ if(c.name && c.image) map[c.name] = c.image; });
//       setCatImages(map);
//     }).catch(()=>{});
//   },[]);

//   const COLD_CATS = ["Mocktail","Cold Coffee","Shake","Juice","Lassi","Cold Drinks"];
//   const HOT_CATS  = ["Tea","Coffee","Hot Drinks","Soup"];
//   const BEV_CATS  = [...COLD_CATS, ...HOT_CATS, "Drinks","Beverages"];
//   const isBeverageCat = BEV_CATS.includes(selCat);

//   // const categories = ["All", ...Array.from(new Set(mi.map(m=>m.category).filter(Boolean)))];
//   const categories = useMemo(() => {
//   const unique = Array.from(new Set(mi.map(m=>m.category).filter(Boolean)));
//   const sorted = [...unique].sort((a,b) => getCategoryRank(a) - getCategoryRank(b));
//   return ["All", ...sorted];
// }, [mi]);

//   const filtered = mi.filter(m=>{
//     const matchCat    = selCat==="All" || m.category===selCat;
//     const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
//     const matchVeg    = vegFilter==="All" || m.tag===vegFilter;
//     const matchTemp   = tempFilter==="All"
//       || (tempFilter==="Cold" && COLD_CATS.includes(m.category))
//       || (tempFilter==="Hot"  && HOT_CATS.includes(m.category));
//     return matchCat && matchSearch && matchVeg && matchTemp;
//   });

//   const getQty    = (id) => cart.find(c=>c.item._id===id)?.qty||0;
//   const addItem   = (item) => setCart(p=>{ const ex=p.find(c=>c.item._id===item._id); return ex?p.map(c=>c.item._id===item._id?{...c,qty:c.qty+1}:c):[...p,{item,qty:1}]; });
//   const removeItem= (id)  => setCart(p=>{ const ex=p.find(c=>c.item._id===id); if(!ex)return p; return ex.qty===1?p.filter(c=>c.item._id!==id):p.map(c=>c.item._id===id?{...c,qty:c.qty-1}:c); });
//   const clearCart = () => setCart([]);

//   const totalQty  = cart.reduce((s,c)=>s+c.qty,0);
//   const subtotal  = cart.reduce((s,c)=>s+c.item.price*c.qty,0);
//   const tax       = Math.round(subtotal*(gstRate/100));
//   const scAmt     = scpi * cart.reduce((s,c)=>s+c.qty,0);
//   const total     = subtotal + tax + scAmt;

//   const handleSubmit = async () => {
//     if(!cart.length) return toast.error("Add at least one item");
//     if(orderType==="Dining"&&!tableNo) return toast.error("Enter table number");
//     try{
//       setLoading(true);
//       const { data } = await placeOrder({
//         items: cart.map(c=>({ menuItemId:c.item._id, qty:c.qty })),
//         orderType, tableNo: orderType==="Dining"?Number(tableNo):null,
//         isGuest: true,
//         customerName:  customerName.trim()||undefined,
//         customerPhone: customerPhone.trim()||undefined,
//         paymentMethod, paymentStatus,
//       });
//       toast.success(`✓ Order ${data.orderId} placed!`);
//       onCreated(data); onClose();
//     }catch(e){ toast.error(e.response?.data?.message||"Failed"); }
//     finally{ setLoading(false); }
//   };

//   const CAT_ICONS = {
//     All:"🍽️", Biryani:"🍛", Burger:"🍔", Pizza:"🍕", Shake:"🥤",
//     Mocktail:"🍹", Coffee:"☕", Tea:"🍵", Dessert:"🍨", Snacks:"🍟",
//     Drinks:"🧃", Juice:"🍊", Lassi:"🥛", Noodles:"🍜", Rice:"🍚",
//   };

//   const getCatIcon = (cat) => {
//     if (catImages[cat]) return catImages[cat];
//     return CAT_ICONS[cat] || "🍽️";
//   };

//   return (
//     <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:999,
//       display:"flex", alignItems:"center", justifyContent:"center",
//       padding:12, backdropFilter:"blur(6px)", fontFamily:"'DM Sans',sans-serif" }}>

//       <div style={{ background:"#0f0e1a", borderRadius:20, width:"100%", maxWidth:1300,
//         height:"92vh", display:"flex", flexDirection:"column",
//         border:`1px solid rgba(139,92,246,0.25)`,
//         boxShadow:"0 30px 80px rgba(0,0,0,0.8)", overflow:"hidden" }}>

//         {/* ── TOP BAR — search only ── */}
//         <div style={{ display:"flex", alignItems:"center", gap:12,
//           padding:"14px 20px", borderBottom:`1px solid ${BDR}`,
//           background:"#13111f", flexShrink:0 }}>

//           <div style={{ flex:1, display:"flex", alignItems:"center", gap:8,
//             background:CARD2, border:`1px solid ${BDR}`, borderRadius:10,
//             padding:"7px 14px" }}>
//             <span style={{ fontSize:16 }}>🔍</span>
//             <input value={search} onChange={e=>setSearch(e.target.value)}
//               placeholder="Search items..."
//               style={{ flex:1, background:"transparent", border:"none",
//                 outline:"none", fontSize:13, color:T1 }}/>
//             {search && <button onClick={()=>setSearch("")}
//               style={{ background:"none", border:"none", color:T3,
//                 cursor:"pointer", fontSize:14 }}>✕</button>}
//           </div>

//           <button onClick={onClose} style={{ width:34, height:34, borderRadius:"50%",
//             border:`1px solid ${BDR}`, background:CARD, cursor:"pointer",
//             display:"flex", alignItems:"center", justifyContent:"center",
//             color:T2, fontSize:16, flexShrink:0 }}>✕</button>
//         </div>

//         {/* ── MAIN CONTENT ── */}
//         <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

//           {/* ── LEFT: Category tabs (vertical) ── */}
//           <div style={{ width:150, background:"#0a0913",
//             borderRight:`1px solid ${BDR}`,
//             display:"flex", flexDirection:"column",
//             overflowY:"auto", flexShrink:0 }}>
//             {categories.map(cat=>{
//               const active = selCat===cat;
//               const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
//               return (
//                 <button key={cat} onClick={()=>setSelCat(cat)} style={{
//                   padding:"14px 8px", border:"none", cursor:"pointer",
//                   background:active?`${PINK}18`:"transparent",
//                   borderLeft:active?`3px solid ${PINK}`:"3px solid transparent",
//                   display:"flex", flexDirection:"column",
//                   alignItems:"center", gap:4, transition:"all .15s",
//                 }}>
//                   {(() => {
//                     const icon = getCatIcon(cat);
//                     return icon?.startsWith?.("http")
//                       ? <img src={icon} alt={cat}
//                           onError={e=>e.target.style.display="none"}
//                           style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/>
//                       : <span style={{ fontSize:22 }}>{icon}</span>;
//                   })()}
//                   <span style={{ fontSize:10, fontWeight:active?700:500,
//                     color:active?PINK:T2, textAlign:"center",
//                     lineHeight:1.2, wordBreak:"break-word" }}>
//                     {cat}
//                   </span>
//                   <span style={{ fontSize:9, color:T3 }}>{count}</span>
//                 </button>
//               );
//             })}
//           </div>

//           {/* ── MIDDLE: Menu items grid ── */}
//           <div style={{ flex:1, overflowY:"auto", padding:16 }}>

//             <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
//               <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
//                 borderRadius:20, border:`1px solid ${BDR}` }}>
//                 {[["All","🍽️ All"],["Veg","🟢 Veg"],["Non Veg","🔴 Non Veg"]].map(([v,label])=>(
//                   <button key={v} onClick={()=>setVegFilter(v)} style={{
//                     padding:"5px 12px", borderRadius:16, border:"none",
//                     cursor:"pointer", fontSize:12, fontWeight:600,
//                     background:vegFilter===v
//                       ? v==="Veg"?"rgba(22,163,74,0.3)"
//                       : v==="Non Veg"?"rgba(239,68,68,0.3)"
//                       : PINK
//                       : "transparent",
//                     color:vegFilter===v
//                       ? v==="Veg"?"#4ade80"
//                       : v==="Non Veg"?"#f87171"
//                       : "#fff"
//                       : T2,
//                     transition:"all .15s",
//                   }}>{label}</button>
//                 ))}
//               </div>

//               <span style={{ fontSize:12, color:T3, alignSelf:"center" }}>
//                 {filtered.length} item{filtered.length!==1?"s":""}
//               </span>
//             </div>

//             {menuLoading ? (
//               <div style={{ textAlign:"center", padding:60, color:T3 }}>
//                 <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
//                 Loading menu...
//               </div>
//             ) : filtered.length===0 ? (
//               <div style={{ textAlign:"center", padding:60, color:T3 }}>
//                 <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
//                 No items found
//               </div>
//             ) : (
//               <div style={{ display:"grid",
//                 gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",
//                 gap:12 }}>
//                 {filtered.map(m=>{
//                   const qty = getQty(m._id);
//                   const inCart = qty > 0;
//                   return (
//                     <div key={m._id} style={{
//                       background:inCart?`${PINK}12`:CARD2,
//                       border:`2px solid ${inCart?PINK:BDR}`,
//                       borderRadius:14, overflow:"hidden",
//                       cursor:"pointer", transition:"all .15s",
//                       display:"flex", flexDirection:"column",
//                       position:"relative",
//                     }}>
//                       <div style={{ height:100, background:"#1a1625",
//                         display:"flex", alignItems:"center", justifyContent:"center",
//                         overflow:"hidden", flexShrink:0 }}>
//                         {m.image?.startsWith("http")
//                           ? <img src={m.image} alt={m.name}
//                               onError={e=>e.target.style.display="none"}
//                               style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
//                           : <span style={{ fontSize:42 }}>🍽️</span>
//                         }
//                       </div>

//                       {inCart && (
//                         <div style={{ position:"absolute", top:8, right:8,
//                           background:PINK, color:"#fff", borderRadius:"50%",
//                           width:24, height:24, display:"flex",
//                           alignItems:"center", justifyContent:"center",
//                           fontSize:12, fontWeight:700 }}>{qty}</div>
//                       )}

//                       <div style={{ padding:"10px 10px 6px", flex:1 }}>
//                         <div style={{ fontWeight:600, fontSize:13, color:T1,
//                           lineHeight:1.3, marginBottom:3 }}>{m.name}</div>
//                         <div style={{ fontSize:11, color:T3 }}>{m.category}</div>
//                         <div style={{ fontWeight:700, fontSize:15, color:PINK,
//                           marginTop:4 }}>₹{m.price}</div>
//                       </div>

//                       <div style={{ padding:"0 8px 10px",
//                         display:"flex", alignItems:"center", gap:6 }}>
//                         {qty===0 ? (
//                           <button onClick={()=>addItem(m)} style={{
//                             flex:1, padding:"8px 0", borderRadius:10,
//                             background:`linear-gradient(135deg,${PINK},#5b21b6)`,
//                             color:"#fff", border:"none", cursor:"pointer",
//                             fontWeight:700, fontSize:13,
//                           }}>+ Add</button>
//                         ) : (
//                           <>
//                             <button onClick={()=>removeItem(m._id)} style={{
//                               width:32, height:32, borderRadius:"50%",
//                               border:`2px solid ${PINK}`, background:"transparent",
//                               color:PINK, cursor:"pointer", fontWeight:700,
//                               fontSize:18, display:"flex", alignItems:"center",
//                               justifyContent:"center",
//                             }}>−</button>
//                             <span style={{ flex:1, textAlign:"center",
//                               fontWeight:700, fontSize:16, color:T1 }}>{qty}</span>
//                             <button onClick={()=>addItem(m)} style={{
//                               width:32, height:32, borderRadius:"50%",
//                               background:PINK, color:"#fff", border:"none",
//                               cursor:"pointer", fontWeight:700, fontSize:18,
//                               display:"flex", alignItems:"center",
//                               justifyContent:"center",
//                             }}>+</button>
//                           </>
//                         )}
//                       </div>
//                     </div>
//                   );
//                 })}
//               </div>
//             )}
//           </div>

//           {/* ── RIGHT: Cart + Order details ── */}
//           <div style={{ width:280, background:"#13111f",
//             borderLeft:`1px solid ${BDR}`,
//             display:"flex", flexDirection:"column", flexShrink:0 }}>

//             {/* Cart header (card section) */}
//             <div style={{ padding:"14px 14px 10px",
//               borderBottom:`1px solid ${BDR}`, flexShrink:0 }}>
//               <div style={{ display:"flex", justifyContent:"space-between",
//                 alignItems:"center" }}>
//                 <div style={{ fontWeight:700, fontSize:15, color:T1 }}>
//                   🛒 Cart
//                   {totalQty>0 && <span style={{ marginLeft:8, background:PINK,
//                     color:"#fff", borderRadius:"50%", width:20, height:20,
//                     display:"inline-flex", alignItems:"center",
//                     justifyContent:"center", fontSize:11, fontWeight:700,
//                   }}>{totalQty}</span>}
//                 </div>
//                 {cart.length>0 && (
//                   <button onClick={clearCart} style={{ background:"none",
//                     border:"none", color:"#f87171", cursor:"pointer",
//                     fontSize:12, fontWeight:600 }}>Clear</button>
//                 )}
//               </div>
//             </div>

//             {/* ── Order details — under the cart card ── */}
//             <div style={{ padding:"12px 14px", borderBottom:`1px solid ${BDR}`,
//               flexShrink:0, display:"flex", flexDirection:"column", gap:8 }}>

//               {/* Order type */}
//               <div style={{ display:"flex", gap:6, background:CARD2, padding:4,
//                 borderRadius:10, border:`1px solid ${BDR}` }}>
//                 {[["Dining","🪑"],["Take Away","🛍️"]].map(([t,icon])=>(
//                   <button key={t} onClick={()=>setOrderType(t)} style={{
//                     flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
//                     fontWeight:700, fontSize:12, border:"none",
//                     background:orderType===t?PINK:"transparent",
//                     color:orderType===t?"#fff":T2, transition:"all .15s",
//                   }}>{icon} {t}</button>
//                 ))}
//               </div>

//               {/* Table number — only for Dining */}
//               {orderType==="Dining" && (
//                 <div style={{ display:"flex", alignItems:"center", gap:8,
//                   background:CARD2, border:`1px solid ${tableNo?PINK:BDR}`,
//                   borderRadius:10, padding:"6px 14px" }}>
//                   <span style={{ fontSize:13, color:T2, fontWeight:500 }}>Table</span>
//                   <input type="number" min={1} value={tableNo}
//                     onChange={e=>setTableNo(e.target.value)}
//                     placeholder="No."
//                     style={{ flex:1, background:"transparent", border:"none",
//                       outline:"none", fontSize:15, fontWeight:700, color:T1,
//                       textAlign:"center" }}/>
//                 </div>
//               )}

//               {/* Customer name */}
//               <input value={customerName} onChange={e=>setCustomerName(e.target.value)}
//                 placeholder="Customer name"
//                 style={inp}/>

//               {/* Customer phone */}
//               <input value={customerPhone}
//                 onChange={e=>setCustomerPhone(e.target.value.replace(/\D/g,""))}
//                 maxLength={10} placeholder="Phone number"
//                 style={inp}/>

//               {/* Payment Method */}
//               <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
//                 borderRadius:8, border:`1px solid ${BDR}` }}>
//                 {["Cash","Online"].map(m=>(
//                   <button key={m} onClick={()=>setPaymentMethod(m)} style={{
//                     flex:1, padding:"6px 0", borderRadius:6, cursor:"pointer",
//                     fontWeight:600, fontSize:12, border:"none",
//                     background:paymentMethod===m?PINK:"transparent",
//                     color:paymentMethod===m?"#fff":T2,
//                   }}>{m==="Cash"?"💵 Cash":"📱 Online"}</button>
//                 ))}
//               </div>

//               {/* Payment Status */}
//               <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
//                 borderRadius:8, border:`1px solid ${BDR}` }}>
//                 {["Pending","Paid"].map(s=>{
//                   const st=PAY_STYLE[s];
//                   return <button key={s} onClick={()=>setPaymentStatus(s)} style={{
//                     flex:1, padding:"6px 0", borderRadius:6, cursor:"pointer",
//                     fontWeight:600, fontSize:12, border:"none",
//                     background:paymentStatus===s?st.bg:"transparent",
//                     color:paymentStatus===s?st.color:T2,
//                   }}>{s==="Paid"?"✓ Paid":"⏳ Due"}</button>;
//                 })}
//               </div>

//               {/* WhatsApp notice */}
//               {customerPhone?.length===10 && (
//                 <span style={{ fontSize:11, color:"#34d399" }}>
//                   📱 Will notify +91 {customerPhone}
//                 </span>
//               )}
//             </div>

//             {/* Cart items */}
//             <div style={{ flex:1, overflowY:"auto", padding:"10px 14px" }}>
//               {cart.length===0 ? (
//                 <div style={{ textAlign:"center", padding:"40px 0", color:T3 }}>
//                   <div style={{ fontSize:36, marginBottom:8 }}>🛒</div>
//                   <div style={{ fontSize:13 }}>No items yet</div>
//                   <div style={{ fontSize:11, marginTop:4 }}>Tap items to add</div>
//                 </div>
//               ) : (
//                 <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
//                   {cart.map(c=>(
//                     <div key={c.item._id} style={{
//                       display:"flex", alignItems:"center", gap:8,
//                       padding:"8px 10px", borderRadius:10,
//                       background:CARD, border:`1px solid ${BDR}`,
//                     }}>
//                       <div style={{ flex:1, minWidth:0 }}>
//                         <div style={{ fontSize:13, fontWeight:600, color:T1,
//                           overflow:"hidden", textOverflow:"ellipsis",
//                           whiteSpace:"nowrap" }}>{c.item.name}</div>
//                         <div style={{ fontSize:11, color:T3 }}>
//                           ₹{c.item.price} × {c.qty}
//                         </div>
//                       </div>
//                       <div style={{ fontWeight:700, color:PINK, fontSize:13,
//                         minWidth:44, textAlign:"right" }}>
//                         ₹{c.item.price*c.qty}
//                       </div>
//                       <div style={{ display:"flex", alignItems:"center", gap:4 }}>
//                         <button onClick={()=>removeItem(c.item._id)} style={{
//                           width:24, height:24, borderRadius:"50%",
//                           border:`1.5px solid ${BDR}`, background:CARD2,
//                           color:T2, cursor:"pointer", fontWeight:700,
//                           fontSize:14, display:"flex", alignItems:"center",
//                           justifyContent:"center",
//                         }}>−</button>
//                         <button onClick={()=>addItem(c.item)} style={{
//                           width:24, height:24, borderRadius:"50%",
//                           background:PINK, color:"#fff", border:"none",
//                           cursor:"pointer", fontWeight:700, fontSize:14,
//                           display:"flex", alignItems:"center",
//                           justifyContent:"center",
//                         }}>+</button>
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//             </div>

//             {/* Bill summary + Place order */}
//             {cart.length>0 && (
//               <div style={{ padding:"12px 14px 16px",
//                 borderTop:`1px solid ${BDR}`, flexShrink:0 }}>
//                 <div style={{ display:"flex", flexDirection:"column", gap:5,
//                   marginBottom:12 }}>
//                   <div style={{ display:"flex", justifyContent:"space-between",
//                     fontSize:12, color:T2 }}>
//                     <span>Subtotal</span><span>₹{subtotal}</span>
//                   </div>
//                   {tax>0 && <div style={{ display:"flex",
//                     justifyContent:"space-between", fontSize:12, color:T2 }}>
//                     <span>GST ({gstRate}%)</span><span>₹{tax}</span>
//                   </div>}
//                   {scAmt>0 && <div style={{ display:"flex",
//                     justifyContent:"space-between", fontSize:12, color:T2 }}>
//                     <span>Service</span><span>₹{scAmt}</span>
//                   </div>}
//                   <div style={{ display:"flex", justifyContent:"space-between",
//                     fontWeight:700, fontSize:17, paddingTop:8,
//                     borderTop:`1px solid ${BDR}`, marginTop:4 }}>
//                     <span style={{ color:T1 }}>Total</span>
//                     <span style={{ color:PINK }}>₹{total}</span>
//                   </div>
//                 </div>

//                 <button onClick={handleSubmit}
//                   disabled={loading||cart.length===0}
//                   style={{ width:"100%", padding:"14px 0", borderRadius:14,
//                     border:"none",
//                     background:loading||cart.length===0
//                       ?"#374151"
//                       :`linear-gradient(135deg,${PINK},#5b21b6)`,
//                     color:loading||cart.length===0?T3:"#fff",
//                     fontWeight:800, fontSize:15, cursor:"pointer",
//                     boxShadow:loading||cart.length===0
//                       ?"none":`0 6px 20px ${PINK}55`,
//                     transition:"all .15s",
//                   }}>
//                   {loading?"Placing...":`Place Order · ₹${total}`}
//                 </button>
//               </div>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };
// // ADD ITEMS TO EXISTING ORDER — Modal Component
// // ═══════════════════════════════════════════════════════════════════════════════
 
// const AddItemsToOrderModal = ({ order, onClose, onItemsAdded }) => {
//   const [mi,          setMi]          = useState([]);
//   const [selCat,      setSelCat]      = useState("All");
//   const [search,      setSearch]      = useState("");
//   const [cart,        setCart]        = useState([]);
//   const [loading,     setLoading]     = useState(false);
//   const [menuLoading, setMenuLoading] = useState(true);
//   const [scpi,        setScpi]        = useState(0);
//   const [gstRate,     setGstRate]     = useState(0);
//   const [paymentMethod,setPaymentMethod] = useState(order.paymentMethod||"Cash");
//   const [paymentStatus,setPaymentStatus] = useState(order.paymentStatus||"Pending");
//   const [vegFilter,   setVegFilter]   = useState("All");
//   const [tempFilter,  setTempFilter]  = useState("All");

//   useEffect(()=>{
//     getMenu({}).then(r=>{ setMi(r.data||[]); setMenuLoading(false); }).catch(()=>setMenuLoading(false));
//     getRestaurantProfile().then(r=>{ const p=r.data?.data||r.data; setScpi(p?.serviceCharge||0); setGstRate(p?.gstRate||0); }).catch(()=>{});
//   },[]);

//   const COLD_CATS = ["Mocktail","Cold Coffee","Shake","Juice","Lassi","Cold Drinks"];
//   const HOT_CATS  = ["Tea","Coffee","Hot Drinks","Soup"];
//   const BEV_CATS  = [...COLD_CATS,...HOT_CATS,"Drinks","Beverages"];
//   const isBeverageCat = BEV_CATS.includes(selCat);

//   const categories = ["All",...Array.from(new Set(mi.map(m=>m.category).filter(Boolean)))];

//   const filtered = mi.filter(m=>{
//     const matchCat    = selCat==="All" || m.category===selCat;
//     const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
//     const matchVeg    = vegFilter==="All" || m.tag===vegFilter;
//     const matchTemp   = tempFilter==="All"
//       || (tempFilter==="Cold" && COLD_CATS.includes(m.category))
//       || (tempFilter==="Hot"  && HOT_CATS.includes(m.category));
//     return matchCat && matchSearch && matchVeg && matchTemp;
//   });

//   const getQty    = (id) => cart.find(c=>c.item._id===id)?.qty||0;
//   const addItem   = (item) => setCart(p=>{ const ex=p.find(c=>c.item._id===item._id); return ex?p.map(c=>c.item._id===item._id?{...c,qty:c.qty+1}:c):[...p,{item,qty:1}]; });
//   const removeItem= (id)  => setCart(p=>{ const ex=p.find(c=>c.item._id===id); if(!ex)return p; return ex.qty===1?p.filter(c=>c.item._id!==id):p.map(c=>c.item._id===id?{...c,qty:c.qty-1}:c); });
//   const clearCart = () => setCart([]);

//   const totalQty = cart.reduce((s,c)=>s+c.qty,0);
//   const subtotal = cart.reduce((s,c)=>s+c.item.price*c.qty,0);
//   const tax      = Math.round(subtotal*(gstRate/100));
//   const scAmt    = scpi*totalQty;
//   const total    = subtotal+tax+scAmt;
//   const isPaid   = order.paymentStatus==="PAID";

//   const CAT_ICONS = {
//     All:"🍽️",Biryani:"🍛",Burger:"🍔",Pizza:"🍕",Shake:"🥤",
//     Mocktail:"🍹",Coffee:"☕",Tea:"🍵",Dessert:"🍨",Snacks:"🍟",
//     Drinks:"🧃",Juice:"🍊",Lassi:"🥛",Noodles:"🍜",Rice:"🍚",
//   };
//   const getCatIcon = (cat) => CAT_ICONS[cat] || "🍽️";

//   const handleSubmit = async () => {
//     if(!cart.length) return toast.error("Add at least one item");
//     try{
//       setLoading(true);
//       const token = localStorage.getItem("adminToken");
//       const response = await fetch(
//         `${import.meta.env.VITE_API_URL}/admin/orders/${order._id}/add-items`,
//         {
//           method:"POST",
//           headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
//           body:JSON.stringify({
//             items: cart.map(c=>({ menuItemId:c.item._id, qty:c.qty })),
//             paymentMethod, paymentStatus,
//           }),
//         }
//       );
//       const data = await response.json();
//       if(!response.ok) throw new Error(data.message||"Failed");
//       toast.success(`✓ Added ${totalQty} items to order`);
//       onItemsAdded(data);
//       onClose();
//     }catch(e){ toast.error(e.message||"Failed"); }
//     finally{ setLoading(false); }
//   };

//   return (
//     <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:999,
//       display:"flex", alignItems:"center", justifyContent:"center",
//       padding:12, backdropFilter:"blur(6px)", fontFamily:"'DM Sans',sans-serif" }}>

//       <div style={{ background:"#0f0e1a", borderRadius:20, width:"100%", maxWidth:1300,
//         height:"92vh", display:"flex", flexDirection:"column",
//         border:`1px solid rgba(139,92,246,0.25)`,
//         boxShadow:"0 30px 80px rgba(0,0,0,0.8)", overflow:"hidden" }}>

//         {/* ── TOP BAR ── */}
//         <div style={{ display:"flex", alignItems:"center", gap:12,
//           padding:"14px 20px", borderBottom:`1px solid ${BDR}`,
//           background:"#13111f", flexShrink:0 }}>

//           {/* Order info */}
//           <div style={{ display:"flex", flexDirection:"column" }}>
//             <span style={{ fontWeight:700, fontSize:15, color:T1 }}>
//               Add Items to Order
//             </span>
//             <span style={{ fontSize:12, color:T2, marginTop:2 }}>
//               {order.orderId} · {order.guestName||order.user?.name||"Guest"}
//               {order.tableNo ? ` · T${order.tableNo}` : ""}
//               · <span style={{ color:isPaid?"#34d399":"#fbbf24", fontWeight:600 }}>
//                   {isPaid?"✓ PAID":"⏳ DUE"} ₹{Math.round(order.total)}
//                 </span>
//             </span>
//           </div>

//           <div style={{ flex:1 }}/>

//           {/* Search */}
//           <div style={{ display:"flex", alignItems:"center", gap:8,
//             background:CARD2, border:`1px solid ${BDR}`, borderRadius:10,
//             padding:"7px 14px", minWidth:200 }}>
//             <span style={{ fontSize:16 }}>🔍</span>
//             <input value={search} onChange={e=>setSearch(e.target.value)}
//               placeholder="Search items…"
//               style={{ flex:1, background:"transparent", border:"none",
//                 outline:"none", fontSize:13, color:T1 }}/>
//             {search && <button onClick={()=>setSearch("")}
//               style={{ background:"none", border:"none", color:T3,
//                 cursor:"pointer", fontSize:14 }}>✕</button>}
//           </div>

//           {/* Payment controls */}
//           <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
//             borderRadius:8, border:`1px solid ${BDR}` }}>
//             {["Cash","Online"].map(m=>(
//               <button key={m} onClick={()=>setPaymentMethod(m)} style={{
//                 padding:"6px 10px", borderRadius:6, cursor:"pointer",
//                 fontWeight:600, fontSize:12, border:"none",
//                 background:paymentMethod===m?PINK:"transparent",
//                 color:paymentMethod===m?"#fff":T2,
//               }}>{m==="Cash"?"💵":"📱"} {m}</button>
//             ))}
//           </div>

//           <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
//             borderRadius:8, border:`1px solid ${BDR}` }}>
//             {["Pending","Paid"].map(s=>{
//               const st=PAY_STYLE[s];
//               return <button key={s} onClick={()=>setPaymentStatus(s)} style={{
//                 padding:"6px 10px", borderRadius:6, cursor:"pointer",
//                 fontWeight:600, fontSize:12, border:"none",
//                 background:paymentStatus===s?st.bg:"transparent",
//                 color:paymentStatus===s?st.color:T2,
//               }}>{s==="Paid"?"✓ Paid":"⏳ Due"}</button>;
//             })}
//           </div>

//           <button onClick={onClose} style={{ width:34, height:34, borderRadius:"50%",
//             border:`1px solid ${BDR}`, background:CARD, cursor:"pointer",
//             display:"flex", alignItems:"center", justifyContent:"center",
//             color:T2, fontSize:16, flexShrink:0 }}>✕</button>
//         </div>

//         {/* ── MAIN CONTENT ── */}
//         <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

//           {/* ── LEFT: Category tabs ── */}
//           <div style={{ width:150, background:"#0a0913",
//             borderRight:`1px solid ${BDR}`,
//             display:"flex", flexDirection:"column",
//             overflowY:"auto", flexShrink:0 }}>
//             {categories.map(cat=>{
//               const active = selCat===cat;
//               const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
//               return (
//                 <button key={cat} onClick={()=>setSelCat(cat)} style={{
//                   padding:"14px 8px", border:"none", cursor:"pointer",
//                   background:active?`${PINK}18`:"transparent",
//                   borderLeft:active?`3px solid ${PINK}`:"3px solid transparent",
//                   display:"flex", flexDirection:"column",
//                   alignItems:"center", gap:4, transition:"all .15s",
//                 }}>
//                 {(() => {
//   const icon = getCatIcon(cat);
//   return icon?.startsWith?.("http")
//     ? <img src={icon} alt={cat}
//         onError={e=>e.target.style.display="none"}
//         style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/>
//     : <span style={{ fontSize:22 }}>{icon}</span>;
// })()}
//                   <span style={{ fontSize:10, fontWeight:active?700:500,
//                     color:active?PINK:T2, textAlign:"center",
//                     lineHeight:1.2, wordBreak:"break-word" }}>
//                     {cat}
//                   </span>
//                   <span style={{ fontSize:9, color:T3 }}>{count}</span>
//                 </button>
//               );
//             })}
//           </div>

//           {/* ── MIDDLE: Menu grid ── */}
//           <div style={{ flex:1, overflowY:"auto", padding:16 }}>

//             {/* Filter toggles */}
//             <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
//               <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
//                 borderRadius:20, border:`1px solid ${BDR}` }}>
//                 {[["All","🍽️ All"],["Veg","🟢 Veg"],["Non Veg","🔴 Non Veg"]].map(([v,label])=>(
//                   <button key={v} onClick={()=>setVegFilter(v)} style={{
//                     padding:"5px 12px", borderRadius:16, border:"none",
//                     cursor:"pointer", fontSize:12, fontWeight:600,
//                     background:vegFilter===v
//                       ? v==="Veg"?"rgba(22,163,74,0.3)"
//                         : v==="Non Veg"?"rgba(239,68,68,0.3)"
//                         : PINK
//                       : "transparent",
//                     color:vegFilter===v
//                       ? v==="Veg"?"#4ade80"
//                         : v==="Non Veg"?"#f87171"
//                         : "#fff"
//                       : T2,
//                   }}>{label}</button>
//                 ))}
//               </div>

//               {(isBeverageCat || selCat==="All") && (
//                 <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
//                   borderRadius:20, border:`1px solid ${BDR}` }}>
//                   {[["All","All"],["Hot","🔥 Hot"],["Cold","🧊 Cold"]].map(([v,label])=>(
//                     <button key={v} onClick={()=>setTempFilter(v)} style={{
//                       padding:"5px 12px", borderRadius:16, border:"none",
//                       cursor:"pointer", fontSize:12, fontWeight:600,
//                       background:tempFilter===v
//                         ? v==="Hot"?"rgba(234,88,12,0.3)"
//                           : v==="Cold"?"rgba(59,130,246,0.3)"
//                           : PINK
//                         : "transparent",
//                       color:tempFilter===v
//                         ? v==="Hot"?"#fb923c"
//                           : v==="Cold"?"#60a5fa"
//                           : "#fff"
//                         : T2,
//                     }}>{label}</button>
//                   ))}
//                 </div>
//               )}
//               <span style={{ fontSize:12, color:T3 }}>{filtered.length} items</span>
//             </div>

//             {menuLoading ? (
//               <div style={{ textAlign:"center", padding:60, color:T3 }}>
//                 <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>Loading menu…
//               </div>
//             ) : filtered.length===0 ? (
//               <div style={{ textAlign:"center", padding:60, color:T3 }}>
//                 <div style={{ fontSize:32, marginBottom:8 }}>📭</div>No items found
//               </div>
//             ) : (
//               <div style={{ display:"grid",
//                 gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
//                 {filtered.map(m=>{
//                   const qty = getQty(m._id);
//                   const inCart = qty>0;
//                   return (
//                     <div key={m._id} style={{
//                       background:inCart?`${PINK}12`:CARD2,
//                       border:`2px solid ${inCart?PINK:BDR}`,
//                       borderRadius:14, overflow:"hidden",
//                       display:"flex", flexDirection:"column",
//                       position:"relative", transition:"all .15s",
//                     }}>
//                       <div style={{ height:100, background:"#1a1625",
//                         display:"flex", alignItems:"center", justifyContent:"center",
//                         overflow:"hidden", flexShrink:0 }}>
//                         {m.image?.startsWith("http")
//                           ? <img src={m.image} alt={m.name} onError={e=>e.target.style.display="none"}
//                               style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
//                           : <span style={{ fontSize:42 }}>🍽️</span>}
//                       </div>
//                       {inCart && (
//                         <div style={{ position:"absolute", top:8, right:8,
//                           background:PINK, color:"#fff", borderRadius:"50%",
//                           width:24, height:24, display:"flex", alignItems:"center",
//                           justifyContent:"center", fontSize:12, fontWeight:700 }}>{qty}</div>
//                       )}
//                       <div style={{ padding:"10px 10px 6px", flex:1 }}>
//                         <div style={{ fontWeight:600, fontSize:13, color:T1,
//                           lineHeight:1.3, marginBottom:3 }}>{m.name}</div>
//                         <div style={{ fontSize:11, color:T3 }}>{m.category}</div>
//                         <div style={{ fontWeight:700, fontSize:15, color:PINK, marginTop:4 }}>₹{m.price}</div>
//                       </div>
//                       <div style={{ padding:"0 8px 10px", display:"flex", alignItems:"center", gap:6 }}>
//                         {qty===0 ? (
//                           <button onClick={()=>addItem(m)} style={{
//                             flex:1, padding:"8px 0", borderRadius:10,
//                             background:`linear-gradient(135deg,${PINK},#5b21b6)`,
//                             color:"#fff", border:"none", cursor:"pointer",
//                             fontWeight:700, fontSize:13,
//                           }}>+ Add</button>
//                         ) : (
//                           <>
//                             <button onClick={()=>removeItem(m._id)} style={{
//                               width:32, height:32, borderRadius:"50%",
//                               border:`2px solid ${PINK}`, background:"transparent",
//                               color:PINK, cursor:"pointer", fontWeight:700,
//                               fontSize:18, display:"flex", alignItems:"center",
//                               justifyContent:"center" }}>−</button>
//                             <span style={{ flex:1, textAlign:"center",
//                               fontWeight:700, fontSize:16, color:T1 }}>{qty}</span>
//                             <button onClick={()=>addItem(m)} style={{
//                               width:32, height:32, borderRadius:"50%",
//                               background:PINK, color:"#fff", border:"none",
//                               cursor:"pointer", fontWeight:700, fontSize:18,
//                               display:"flex", alignItems:"center",
//                               justifyContent:"center" }}>+</button>
//                           </>
//                         )}
//                       </div>
//                     </div>
//                   );
//                 })}
//               </div>
//             )}
//           </div>

//           {/* ── RIGHT: Cart ── */}
//           <div style={{ width:280, background:"#13111f",
//             borderLeft:`1px solid ${BDR}`,
//             display:"flex", flexDirection:"column", flexShrink:0 }}>

//             {/* Current order summary */}
//             <div style={{ padding:"14px 14px 10px",
//               borderBottom:`1px solid ${BDR}`, flexShrink:0 }}>
//               <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
//                 textTransform:"uppercase", marginBottom:8 }}>Current Order</div>
//               <div style={{ background:CARD2, borderRadius:8, padding:10,
//                 border:`1px solid ${isPaid?"rgba(16,185,129,0.3)":"rgba(245,158,11,0.3)"}` }}>
//                 <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}>
//                   <span style={{ color:T3 }}>Items</span>
//                   <span style={{ color:T1, fontWeight:500 }}>{order.items?.length||0}</span>
//                 </div>
//                 <div style={{ display:"flex", justifyContent:"space-between", fontSize:13,
//                   fontWeight:700, marginTop:4 }}>
//                   <span style={{ color:T1 }}>Total</span>
//                   <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
//                 </div>
//                 <div style={{ marginTop:6, display:"flex", gap:6 }}>
//                   <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px",
//                     borderRadius:20,
//                     background:isPaid?"rgba(16,185,129,0.15)":"rgba(245,158,11,0.15)",
//                     color:isPaid?"#34d399":"#fbbf24" }}>
//                     {isPaid?"✓ PAID":"⏳ DUE"}
//                   </span>
//                 </div>
//               </div>
//             </div>

//             {/* New items cart header */}
//             <div style={{ padding:"10px 14px 6px", flexShrink:0 }}>
//               <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
//                 <span style={{ fontSize:13, fontWeight:700, color:T1 }}>
//                   New Items
//                   {totalQty>0 && <span style={{ marginLeft:8, background:PINK,
//                     color:"#fff", borderRadius:"50%", width:20, height:20,
//                     display:"inline-flex", alignItems:"center",
//                     justifyContent:"center", fontSize:11, fontWeight:700,
//                   }}>{totalQty}</span>}
//                 </span>
//                 {cart.length>0 && (
//                   <button onClick={clearCart} style={{ background:"none",
//                     border:"none", color:"#f87171", cursor:"pointer",
//                     fontSize:12, fontWeight:600 }}>Clear</button>
//                 )}
//               </div>
//             </div>

//             {/* Cart items */}
//             <div style={{ flex:1, overflowY:"auto", padding:"4px 14px" }}>
//               {cart.length===0 ? (
//                 <div style={{ textAlign:"center", padding:"30px 0", color:T3 }}>
//                   <div style={{ fontSize:32, marginBottom:6 }}>➕</div>
//                   <div style={{ fontSize:12 }}>Select items to add</div>
//                 </div>
//               ) : (
//                 <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
//                   {cart.map(c=>(
//                     <div key={c.item._id} style={{
//                       display:"flex", alignItems:"center", gap:8,
//                       padding:"8px 10px", borderRadius:10,
//                       background:CARD, border:`1px solid ${BDR}`,
//                     }}>
//                       <div style={{ flex:1, minWidth:0 }}>
//                         <div style={{ fontSize:13, fontWeight:600, color:T1,
//                           overflow:"hidden", textOverflow:"ellipsis",
//                           whiteSpace:"nowrap" }}>{c.item.name}</div>
//                         <div style={{ fontSize:11, color:T3 }}>₹{c.item.price} × {c.qty}</div>
//                       </div>
//                       <div style={{ fontWeight:700, color:PINK, fontSize:13, minWidth:44, textAlign:"right" }}>
//                         ₹{c.item.price*c.qty}
//                       </div>
//                       <div style={{ display:"flex", alignItems:"center", gap:4 }}>
//                         <button onClick={()=>removeItem(c.item._id)} style={{
//                           width:24, height:24, borderRadius:"50%",
//                           border:`1.5px solid ${BDR}`, background:CARD2,
//                           color:T2, cursor:"pointer", fontWeight:700, fontSize:14,
//                           display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
//                         <button onClick={()=>addItem(c.item)} style={{
//                           width:24, height:24, borderRadius:"50%",
//                           background:PINK, color:"#fff", border:"none",
//                           cursor:"pointer", fontWeight:700, fontSize:14,
//                           display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//             </div>

//             {/* Bill + confirm */}
//             {cart.length>0 && (
//               <div style={{ padding:"12px 14px 16px",
//                 borderTop:`1px solid ${BDR}`, flexShrink:0 }}>
//                 <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
//                   <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2 }}>
//                     <span>New subtotal</span><span>₹{subtotal}</span>
//                   </div>
//                   {tax>0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2 }}>
//                     <span>GST ({gstRate}%)</span><span>₹{tax}</span>
//                   </div>}
//                   <div style={{ display:"flex", justifyContent:"space-between",
//                     fontWeight:700, fontSize:14, paddingTop:6,
//                     borderTop:`1px solid ${BDR}`, marginTop:2 }}>
//                     <span style={{ color:T1 }}>New Total</span>
//                     <span style={{ color:PINK }}>₹{total}</span>
//                   </div>
//                   <div style={{ fontSize:11, color:T3, textAlign:"center", marginTop:4 }}>
//                     Order total: ₹{Math.round(order.total)} → ₹{Math.round(Number(order.total||0)+total)}
//                   </div>
//                 </div>

//                 <button onClick={handleSubmit} disabled={loading||cart.length===0} style={{
//                   width:"100%", padding:"13px 0", borderRadius:14, border:"none",
//                   background:loading?"#374151":`linear-gradient(135deg,${PINK},#5b21b6)`,
//                   color:loading?T3:"#fff", fontWeight:800, fontSize:14,
//                   cursor:loading?"not-allowed":"pointer",
//                   boxShadow:loading?"none":`0 6px 20px ${PINK}55`,
//                 }}>
//                   {loading?`Adding…`:`Add Items · ₹${total}`}
//                 </button>
//               </div>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };
// // ══════════════════════════════════════════════════════════════════════════════
// // MAIN ORDERS PAGE
// // ══════════════════════════════════════════════════════════════════════════════
// // const MultiOrderTableView = ({ orders, tableNo, onStatusChange, onPaymentChange }) => {



// // ═══════════════════════════════════════════════════════════════════════════════
// // REPLACE your existing MultiOrderTableView with this version
// // ═══════════════════════════════════════════════════════════════════════════════
 
// const MultiOrderTableView = ({ orders, tableNo, onStatusChange, onPaymentChange, onCombinedBill, onAddItems }) => {
//   const [expandedOrder, setExpandedOrder] = useState(null);
 
//   if (orders.length === 0) {
//     return (
//       <div style={{ marginTop:14, textAlign:"center", padding:20, color:T3,
//         fontSize:12, border:`1px dashed ${BDR}`, borderRadius:10 }}>
//         Table {tableNo} is free
//       </div>
//     );
//   }
 
//   const grandTotal  = orders.reduce((s,o) => s + Number(o.total||0), 0);
//   const paidTotal   = orders.filter(o=>o.paymentStatus==="PAID").reduce((s,o) => s + Number(o.total||0), 0);
//   const dueTotal    = grandTotal - paidTotal;
//   const paidOrders  = orders.filter(o=>o.paymentStatus==="PAID");
//   const unpaidOrders= orders.filter(o=>o.paymentStatus!=="PAID");
 
//   return (
//     <div style={{ marginTop:14 }}>
 
//       {/* ── Header ── */}
//       <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
//         <span style={{ fontSize:11, fontWeight:600, color:T2, letterSpacing:1, textTransform:"uppercase" }}>
//           Table {tableNo} · {orders.length} order{orders.length!==1?"s":""}
//         </span>
//         <span style={{ fontSize:10, color:T3 }}>
//           {paidOrders.length} paid · {unpaidOrders.length} pending
//         </span>
//       </div>
 
//       {/* ── UNPAID orders first (need attention) ── */}
//       {unpaidOrders.length > 0 && (
//         <div style={{ marginBottom:10 }}>
//           <div style={{ fontSize:10, fontWeight:700, color:"#f87171", letterSpacing:1,
//             textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
//             <div style={{ width:6, height:6, borderRadius:"50%", background:"#f87171" }}/>
//             Pending Payment ({unpaidOrders.length})
//           </div>
//           {unpaidOrders.map((order, idx) => (
//             <OrderCard
//               key={order._id}
//               order={order}
//               idx={idx}
//               isExpanded={expandedOrder===order._id}
//               onExpand={()=>setExpandedOrder(expandedOrder===order._id?null:order._id)}
//               onStatusChange={onStatusChange}
//               onPaymentChange={onPaymentChange}
//               onCombinedBill={onCombinedBill}
//               onAddItems={onAddItems}
//               highlight="unpaid"
//             />
//           ))}
//         </div>
//       )}
 
//       {/* ── PAID orders ── */}
//       {paidOrders.length > 0 && (
//         <div style={{ marginBottom:10 }}>
//           <div style={{ fontSize:10, fontWeight:700, color:"#34d399", letterSpacing:1,
//             textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
//             <div style={{ width:6, height:6, borderRadius:"50%", background:"#34d399" }}/>
//             Paid ({paidOrders.length})
//           </div>
//           {paidOrders.map((order, idx) => (
//             <OrderCard
//               key={order._id}
//               order={order}
//               idx={idx}
//               isExpanded={expandedOrder===order._id}
//               onExpand={()=>setExpandedOrder(expandedOrder===order._id?null:order._id)}
//               onStatusChange={onStatusChange}
//               onPaymentChange={onPaymentChange}
//               onCombinedBill={onCombinedBill}
//               onAddItems={onAddItems}
//               highlight="paid"
//             />
//           ))}
//         </div>
//       )}
 
//       {/* ── Bill summary ── */}
//       <div style={{ padding:14, background:`${PINK}08`, borderRadius:12,
//         border:`1px solid ${PINK}33`, marginTop:8 }}>
//         <div style={{ fontSize:11, fontWeight:600, color:T2, textTransform:"uppercase",
//           letterSpacing:1, marginBottom:10 }}>Table Bill Summary</div>
 
//         {/* Per order breakdown */}
//         {orders.map((o,i) => {
//           const paid = o.paymentStatus==="PAID";
//           return (
//             <div key={o._id} style={{ display:"flex", justifyContent:"space-between",
//               alignItems:"center", padding:"5px 0",
//               borderBottom:`1px solid rgba(255,255,255,0.05)`, fontSize:12 }}>
//               <div style={{ display:"flex", alignItems:"center", gap:6 }}>
//                 <div style={{ width:6, height:6, borderRadius:"50%",
//                   background:paid?"#34d399":"#f87171", flexShrink:0 }}/>
//                 <span style={{ color:T2 }}>
//                   {o.user?.name||o.guestName||`Order ${i+1}`}
//                 </span>
//                 <span style={{ fontSize:10, color:T3 }}>({o.items?.length||0} items)</span>
//               </div>
//               <div style={{ display:"flex", alignItems:"center", gap:8 }}>
//                 <span style={{ fontSize:11,
//                   color:paid?"#34d399":"#fbbf24",
//                   fontWeight:600 }}>
//                   {paid?"✓ Paid":"⏳ Due"}
//                 </span>
//                 <span style={{ fontWeight:700, color:T1 }}>₹{Math.round(o.total)}</span>
//               </div>
//             </div>
//           );
//         })}
 
//         {/* Totals */}
//         <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${BDR}` }}>
//           {paidTotal > 0 && (
//             <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#34d399", marginBottom:4 }}>
//               <span>✓ Paid</span><span>₹{Math.round(paidTotal)}</span>
//             </div>
//           )}
//           {dueTotal > 0 && (
//             <div style={{ display:"flex", justifyContent:"space-between", fontSize:13,
//               fontWeight:700, color:"#f87171", marginBottom:4 }}>
//               <span>⏳ Due</span><span>₹{Math.round(dueTotal)}</span>
//             </div>
//           )}
//           <div style={{ display:"flex", justifyContent:"space-between",
//             fontSize:15, fontWeight:700, marginTop:6, paddingTop:6, borderTop:`1px solid ${BDR}` }}>
//             <span style={{ color:T1 }}>Grand Total</span>
//             <span style={{ color:PINK }}>₹{Math.round(grandTotal)}</span>
//           </div>
//         </div>
//       </div>
 
//       {/* Combined bill button */}
//       {onCombinedBill && (
//         <button onClick={()=>onCombinedBill("table", tableNo)}
//           style={{ width:"100%", marginTop:10, padding:"10px", borderRadius:10,
//             border:`1px solid ${PINK}44`, background:`${PINK}10`,
//             color:PINK, cursor:"pointer", fontSize:13, fontWeight:600 }}>
//           🧾 Generate Combined Bill for Table {tableNo}
//         </button>
//       )}
//     </div>
//   );
// };
 
// // ── OrderCard — individual order row inside table view ─────────────────────────
// const OrderCard = ({ order, idx, isExpanded, onExpand, onStatusChange, onPaymentChange, onCombinedBill, onAddItems, highlight }) => {
//   const displayName  = order.user?.name || order.guestName || `Order ${idx+1}`;
//   const displayPhone = order.guestPhone||order.user?.phone ||  null;
//   const av           = avc(displayName);
//   const isPaid       = order.paymentStatus === "PAID";
//   const canAddItems  = ["CONFIRMED","PREPARING","READY"].includes(order.status);
 
//   const borderColor = isPaid ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)";
//   const bgColor     = isPaid ? "rgba(16,185,129,0.04)" : "rgba(245,158,11,0.04)";
 
//   return (
//     <div style={{ marginBottom:6, borderRadius:10, overflow:"hidden",
//       border:`1px solid ${isExpanded ? PINK+"55" : borderColor}`,
//       background: isExpanded ? `${PINK}05` : bgColor }}>
 
//       {/* Row header */}
//       <div onClick={onExpand} style={{ padding:"11px 13px", display:"flex",
//         alignItems:"center", gap:10, cursor:"pointer" }}>
 
//         {/* Avatar */}
//         <div style={{ width:30, height:30, borderRadius:"50%", background:av.bg, color:av.c,
//           display:"flex", alignItems:"center", justifyContent:"center",
//           fontSize:11, fontWeight:600, flexShrink:0 }}>
//           {ini(displayName)}
//         </div>
 
//         {/* Name + order info */}
//         <div style={{ flex:1, minWidth:0 }}>
//           <div style={{ fontSize:13, fontWeight:600, color:T1 }}>{displayName}</div>
//           <div style={{ fontSize:11, color:T3, marginTop:2 }}>
//             {order.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")||"—"}
//           </div>
//         </div>
 
//         {/* Right side — payment + total */}
//         <div style={{ textAlign:"right", flexShrink:0 }}>
//           <div style={{ fontSize:14, fontWeight:700, color:PINK }}>₹{Math.round(order.total)}</div>
//           <div style={{ display:"flex", gap:4, justifyContent:"flex-end", marginTop:3 }}>
//             {/* Paid/Due pill */}
//             <span style={{
//               fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
//               background: isPaid ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
//               color: isPaid ? "#34d399" : "#fbbf24",
//             }}>
//               {isPaid ? "✓ PAID" : "⏳ DUE"}
//             </span>
//             {/* Order status */}
//             <span style={{
//               fontSize:10, padding:"2px 7px", borderRadius:20,
//               background: STATUS_STYLE[order.status]?.bg || "rgba(107,114,128,0.15)",
//               color: STATUS_STYLE[order.status]?.color || "#9ca3af",
//             }}>{order.status}</span>
//           </div>
//         </div>
 
//         <span style={{ fontSize:12, color:T3 }}>{isExpanded?"▲":"▼"}</span>
//       </div>
 
//       {/* Expanded detail */}
//       {isExpanded && (
//         <div style={{ padding:"0 13px 13px", borderTop:`1px solid ${BDR}` }}>
 
//           {/* Items list */}
//           <div style={{ marginTop:10, marginBottom:10 }}>
//             {order.items?.map((item,i) => (
//               <div key={i} style={{ display:"flex", justifyContent:"space-between",
//                 padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)`, fontSize:12 }}>
//                 <div style={{ display:"flex", gap:8, alignItems:"center" }}>
//                   <div style={{ width:20, height:20, borderRadius:5, background:`${PINK}20`,
//                     display:"flex", alignItems:"center", justifyContent:"center",
//                     fontSize:10, fontWeight:600, color:PINK }}>{item.qty}</div>
//                   <span style={{ color:T1 }}>{item.name}</span>
//                 </div>
//                 <span style={{ color:T1, fontWeight:500 }}>₹{item.price*item.qty}</span>
//               </div>
//             ))}
//             <div style={{ display:"flex", justifyContent:"space-between",
//               fontWeight:700, fontSize:14, marginTop:8, color:T1 }}>
//               <span>Total</span>
//               <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
//             </div>
//           </div>
 
//           {/* Order info */}
//           <div style={{ fontSize:11, color:T3, marginBottom:10 }}>
//             {order.orderId} · {displayPhone ? `+91 ${displayPhone}` : "No phone"} · {order.paymentMethod||"Cash"}
//           </div>
 
//           {/* Order Status buttons */}
//           <div style={{ marginBottom:8 }}>
//             <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
//               textTransform:"uppercase", marginBottom:6 }}>Order Status</div>
//             <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
//               {["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"]
//                 .filter(s=>s!==order.status).map(s => {
//                   const st = STATUS_STYLE[s];
//                   return (
//                     <button key={s} onClick={()=>{ onStatusChange(order._id,s); }}
//                       style={{ padding:"4px 10px", borderRadius:20, border:`1px solid ${st.color}44`,
//                         background:st.bg, color:st.color, cursor:"pointer", fontSize:11, fontWeight:500 }}>
//                       {s}
//                     </button>
//                   );
//                 })}
//             </div>
//           </div>
 
//           {/* Payment Status buttons */}
//           <div style={{ marginBottom:8 }}>
//             <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
//               textTransform:"uppercase", marginBottom:6 }}>Payment Status</div>
//             <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
//               {["PENDING_VERIFICATION","PAID","FAILED"].map(s => {
//                 const st = PAY_STYLE[s];
//                 const active = order.paymentStatus===s;
//                 return (
//                   <button key={s} onClick={()=>!active&&onPaymentChange(order._id,{ paymentStatus:s })}
//                     style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600,
//                       cursor:active?"default":"pointer",
//                       border:`1px solid ${active?st.color+"88":st.color+"44"}`,
//                       background:active?st.bg:"transparent",
//                       color:st.color, opacity:active?1:0.65 }}>
//                     {active?"✓ ":""}{{PENDING_VERIFICATION:"Pending",PAID:"Paid",FAILED:"Failed"}[s]}
//                   </button>
//                 );
//               })}
//             </div>
//           </div>
 
//           {/* Payment Method buttons */}
//           <div style={{ marginBottom:10 }}>
//             <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
//               textTransform:"uppercase", marginBottom:6 }}>Payment Method</div>
//             <div style={{ display:"flex", gap:5 }}>
//               {["Cash","Online"].map(m => {
//                 const active = (order.paymentMethod||"Cash")===m;
//                 return (
//                   <button key={m} onClick={()=>!active&&onPaymentChange(order._id,{ paymentMethod:m })}
//                     style={{ padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:600,
//                       cursor:active?"default":"pointer",
//                       border:`2px solid ${active?PINK:BDR}`,
//                       background:active?`${PINK}15`:CARD2,
//                       color:active?PINK:T2 }}>
//                     {m==="Cash"?"💵":"📱"} {m}
//                   </button>
//                 );
//               })}
//             </div>
//           </div>
 
//           {/* Action buttons */}
//          {/* Action buttons */}
// <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
//   {canAddItems && onAddItems && (
//     <button onClick={()=>onAddItems(order)}
//       style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
//         border:`1px solid ${PINK}44`, background:`${PINK}10`, color:PINK, cursor:"pointer" }}>
//       + Add items
//     </button>
//   )}
//   {displayPhone && onCombinedBill && (
//     <button onClick={()=>onCombinedBill("phone", displayPhone)}
//       style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
//         border:"1px solid rgba(139,92,246,0.4)", background:"rgba(139,92,246,0.1)",
//         color:"#c4b5fd", cursor:"pointer" }}>
//       🧾 Customer Bill
//     </button>
//   )}

//   {/* ← ADD THIS */}
//   <button onClick={async()=>{
//   try{
//    await printOrderBill(order._id); 
//     toast.success("Bill sent to printer ✓");
//   }catch{ toast.error("Printer not running"); }
// }} style={{ padding:"5px 12px", borderRadius:8, fontSize:12, cursor:"pointer",
//   border:"1px solid rgba(16,185,129,0.4)", background:"rgba(16,185,129,0.1)",
//   color:"#34d399", whiteSpace:"nowrap" }}>
//   🖨️ Bill
// </button>
// </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default function OrdersPage() {
//   const [orders,setOrders]=useState([]);
//   const [loading,setLoading]=useState(true);
//   const [search,setSearch]=useState("");
//   const [filter,setFilter]=useState("All");
//   const [typeF,setTypeF]=useState("All");
//   const [payF,setPayF]=useState("All");
//   const [expanded,setExpanded]=useState(null);
//   const [showCreate,setShowCreate]=useState(false);
//   const [showAddItems, setShowAddItems] = useState(null); // ← ADD THIS (order._id or null)
//   const [page,setPage]=useState(1);
//   const [startDate,setStartDate]=useState("");
//   const [endDate,setEndDate]=useState("");
//   const [viewMode,setViewMode]=useState("recent");
//   const [tables,setTables]=useState([]);
//   const [tablesLoading,setTablesLoading]=useState(true);
//   const [tableSelected,setTableSelected]=useState(null);
//   const [showCombinedBill, setShowCombinedBill] = useState(null); 
//   const [showTables, setShowTables] = useState(true);
//   const PER_PAGE=15;

//   const fetchTables=useCallback(()=>{ getAllTables().then(r=>{setTables(r.data?.tables||[]);setTablesLoading(false);}).catch(()=>setTablesLoading(false)); },[]);
//   useEffect(()=>{ fetchTables(); },[fetchTables]);

//   const fetchOrders=useCallback(()=>{
//     getAllOrders({ limit:10000 }).then(r=>{ setOrders(r.data?.orders||[]); setLoading(false); })
//       .catch(()=>{ toast.error("Failed to load orders"); setLoading(false); });
//   },[]);
//   useEffect(()=>{ fetchOrders(); },[fetchOrders]);

//   useEffect(()=>{
//     const handleKeyDown=(e)=>{
//       if(showCreate) return;
//       const tag=document.activeElement?.tagName;
//       const isTyping=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||document.activeElement?.isContentEditable;
//       if(isTyping) return;
//       if(e.key.toLowerCase()==="n"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){ e.preventDefault(); setShowCreate(true); }
//     };
//     window.addEventListener("keydown",handleKeyDown);
//     return()=>window.removeEventListener("keydown",handleKeyDown);
//   },[showCreate]);

//   const filtered=orders.filter(o=>{
//     const q=search.toLowerCase();
//     const d=new Date(o.createdAt).toISOString().slice(0,10);
//     return (filter==="All"||o.status===filter)&&(typeF==="All"||o.orderType===typeF)&&
//            (payF==="All"||o.paymentStatus===payF)&&(!startDate||d>=startDate)&&(!endDate||d<=endDate)&&
//            (!q||o.orderId?.toLowerCase().includes(q)||o.guestName?.toLowerCase().includes(q)||
//             o.guestName?.toLowerCase().includes(q)||o.guestPhone?.includes(q)||o.user?.phone?.includes(q));
//   });

//   const recentFiltered=orders.filter(o=>{
//     const q=search.toLowerCase();
//     return new Date(o.createdAt).toDateString()===new Date().toDateString()&&
//            ACTIVE_ORDER_STATUSES.includes(o.status)&&
//            (!q||o.orderId?.toLowerCase().includes(q)||o.guestName?.toLowerCase().includes(q)||
//             o.guestName?.toLowerCase().includes(q)||o.guestPhone?.includes(q)||o.user?.phone?.includes(q));
//   });

//   const displayedOrders=viewMode==="recent"?recentFiltered:filtered;
//   const ordersInRange=orders.filter(o=>{ const d=new Date(o.createdAt).toISOString().slice(0,10); return (!startDate||d>=startDate)&&(!endDate||d<=endDate); });
//   const rangeStats={ count:filtered.filter(o=>o.status==="COMPLETED"&&o.paymentStatus==="PAID").length, amount:ordersInRange.filter(o=>o.status==="COMPLETED"&&o.paymentStatus==="PAID").reduce((s,o)=>s+Number(o.total||0),0) };

//   const handleStatusChange=async(id,newStatus)=>{
//     try{ await updateOrderStatus(id,newStatus); setOrders(prev=>prev.map(o=>o._id===id?{...o,status:newStatus}:o)); toast.success(`→ ${newStatus}`); }
//     catch{ toast.error("Update failed"); }
//   };

//   const handlePaymentChange=async(id,data)=>{
//     try{
//       // Use updateInvoiceStatus pattern or direct order patch
//       await fetch(`${import.meta.env.VITE_API_URL}/admin/orders/${id}/payment`,{
//         method:"PATCH",
//         headers:{ "Content-Type":"application/json", Authorization:`Bearer ${localStorage.getItem("adminToken")}` },
//         body:JSON.stringify(data),
//       });
//       setOrders(prev=>prev.map(o=>o._id===id?{...o,...data}:o));
//       toast.success("Payment updated ✓");
//     }catch{ toast.error("Payment update failed"); }
//   };

//   // const tableOrderMap={};
//   // orders.filter(o=>o.orderType==="Dining"&&o.tableNo&&ACTIVE_ORDER_STATUSES.includes(o.status))
//   //   .forEach(o=>{ tableOrderMap[Number(o.tableNo)]=o; });
//   // const selectedTableOrder=tableSelected?tableOrderMap[tableSelected]||null:null;
//   const tableOrderMap = {};
// orders
//   .filter(o => o.orderType === "DINE_IN" && o.tableNo && ACTIVE_ORDER_STATUSES.includes(o.status))
//   .forEach(o => {
//     const tNum = Number(o.tableNo);
//     if (!tableOrderMap[tNum]) tableOrderMap[tNum] = [];
//     tableOrderMap[tNum].push(o);
//   });
 
// const selectedTableOrders = tableSelected ? tableOrderMap[tableSelected] || [] : [];
// const selectedTableTotal = selectedTableOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

//   const paginated=displayedOrders.slice((page-1)*PER_PAGE,page*PER_PAGE);
//   const totalPages=Math.ceil(displayedOrders.length/PER_PAGE);

//   // ── Stats ──────────────────────────────────────────────────────────────────
//   // ── Stats ──────────────────────────────────────────────────────────────────
// const today = new Date().toDateString();

// // Only today's orders for all stats
// const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);

// const stats = {
//   total:        todayOrders.length,
//   revenue:      todayOrders.filter(o => o.paymentStatus === "PAID")
//                   .reduce((s,o) => s + Number(o.total||0), 0),
//   active:       todayOrders.filter(o => ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"].includes(o.status)).length,
//   paid:         todayOrders.filter(o => o.paymentStatus === "PAID").length,
//   paidAmount:   todayOrders.filter(o => o.paymentStatus === "PAID")
//                   .reduce((s,o) => s + Number(o.total||0), 0),
//   unpaid:       todayOrders.filter(o => o.paymentStatus === "PENDING_VERIFICATION").length,
//   unpaidAmount: todayOrders.filter(o => o.paymentStatus === "PENDING_VERIFICATION")
//                   .reduce((s,o) => s + Number(o.total||0), 0),
// cash:         todayOrders.filter(o => o.paymentMethod === "Cash" && o.paymentStatus === "PAID").length,
// cashAmount:   todayOrders.filter(o => o.paymentMethod === "Cash" && o.paymentStatus === "PAID")
//                 .reduce((s,o) => s + Number(o.total||0), 0),
// online:       todayOrders.filter(o => o.paymentMethod === "Online" && o.paymentStatus === "PAID").length,
// onlineAmount: todayOrders.filter(o => o.paymentMethod === "Online" && o.paymentStatus === "PAID")
//                 .reduce((s,o) => s + Number(o.total||0), 0),
// };

//   const clearFilters=()=>{ setSearch(""); setFilter("All"); setTypeF("All"); setPayF("All"); setStartDate(""); setEndDate(""); setPage(1); };
//   const hasFilters=search||filter!=="All"||typeF!=="All"||payF!=="All"||startDate||endDate;

//   return (
//     <div style={{ padding:28, fontFamily:"'DM Sans',sans-serif" }}>

//     {/* Header */}
// <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>

//   {/* LEFT: Title + Toggle side by side */}
//   <div style={{ display:"flex", alignItems:"center", gap:12 }}>
//     <div>
//       <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>
//         {viewMode==="recent"?"Recent Orders":"All Orders"}
//       </h1>
//       <div style={{ fontSize:13, color:T2, marginTop:4 }}>
//         {viewMode==="recent"?"Today's active orders":"Search, filter and manage every order"}
//       </div>
//     </div>

//     {/* Toggle — right of title */}
//     <button onClick={()=>setShowTables(t=>!t)} style={{
//       padding:"6px 14px", borderRadius:20, fontWeight:600, fontSize:12,
//       cursor:"pointer", border:`1px solid ${showTables?PINK:BDR}`,
//       background:showTables?`${PINK}15`:CARD2,
//       color:showTables?PINK:T2,
//       display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap",
//       alignSelf:"flex-start", marginTop:2,
//     }}>
//       🪑 {showTables ? "Hide Tables" : "Show Tables"}
//     </button>
//   </div>

//   {/* RIGHT: Create Order button */}
//   <button onClick={()=>setShowCreate(true)} style={{ padding:"11px 22px", background:`linear-gradient(135deg,${PINK},#5b21b6)`, color:"#fff", border:"none", borderRadius:25, fontWeight:700, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", gap:8, boxShadow:`0 4px 14px ${PINK}44` }}>
//     <span style={{ fontSize:18 }}>+</span> Create Order
//     <span style={{ fontSize:10, fontWeight:700, background:"rgba(255,255,255,0.2)", padding:"2px 6px", borderRadius:5, fontFamily:"monospace" }}>N</span>
//   </button>
// </div>
     

//       {/* <style>{`
//         .orders-layout { display:grid; grid-template-columns:minmax(0,7fr) minmax(280px,3fr); gap:16px; align-items:start; }
//         @media(max-width:900px){ .orders-layout{ grid-template-columns:1fr !important; } }
//       `}</style> */}

//     <div style={{ display:"grid", gridTemplateColumns:showTables?"minmax(0,7fr) minmax(280px,3fr)":"1fr", gap:16, alignItems:"start" }}>

//         {/* ── LEFT — Orders ── */}
//         <div style={{ minWidth:0 }}>

//           {/* ── 8 Stat boxes ── */}
//         {/* ── Today's Stats — Row 1 ── */}
// <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:10 }}>
//   <StatPill icon="📦" label="Today's Orders"    value={stats.total}                              />
//   <StatPill icon="💰" label="Today's Collected" value={`₹${fmt(stats.revenue)}`} color="#34d399"/>
//   <StatPill icon="⏳" label="Active Orders"     value={stats.active}  color="#fbbf24"           />
//   <StatPill icon="📅" label="Total Orders Ever" value={orders.length} color={PINK}              />
// </div>

// {/* ── Today's Stats — Row 2 ── */}
// <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
//   <StatPill icon="✅" label="Today Paid"
//     value={stats.paid}   color="#34d399" sub={`₹${fmt(stats.paidAmount)}`}/>
//   <StatPill icon="🔴" label="Today Due"
//     value={stats.unpaid} color="#f87171" sub={`₹${fmt(stats.unpaidAmount)}`}/>
// <StatPill icon="💵" label="Cash Collected"   value={stats.cash}   color="#fbbf24" sub={`₹${fmt(stats.cashAmount)}`}/>
// <StatPill icon="📱" label="Online Collected" value={stats.online} color="#c4b5fd" sub={`₹${fmt(stats.onlineAmount)}`}/>
// </div>
//           {/* <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
//             <StatPill icon="✅" label="Paid orders"
//               value={stats.paid} color="#34d399"
//               sub={`₹${fmt(stats.paidAmount)}`}/>
//             <StatPill icon="🔴" label="Due Payments"
//               value={stats.unpaid} color="#f87171"
//               sub={`₹${fmt(stats.unpaidAmount)}`}/>
//             <StatPill icon="💵" label="Cash payments"
//               value={stats.cash} color="#fbbf24"
//               sub={`₹${fmt(stats.cashAmount)}`}/>
//             <StatPill icon="📱" label="Online payments"
//               value={stats.online} color="#c4b5fd"
//               sub={`₹${fmt(stats.onlineAmount)}`}/>
//           </div> */}

//           {/* ── Filter bar ── */}
//           <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:16, marginBottom:16 }}>
//             <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
//               {/* View mode tabs */}
//               <div style={{ display:"flex", gap:4, background:CARD2, padding:4, borderRadius:10, border:`1px solid ${BDR}`, flexShrink:0 }}>
//                 <button onClick={()=>{ setViewMode("recent"); setPage(1); }} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", whiteSpace:"nowrap", background:viewMode==="recent"?PINK:"transparent", color:viewMode==="recent"?"#fff":T2 }}>Recent · Today</button>
//                 <button onClick={()=>{ setViewMode("all"); setPage(1); }} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", whiteSpace:"nowrap", background:viewMode==="all"?PINK:"transparent", color:viewMode==="all"?"#fff":T2 }}>All Orders</button>
//               </div>
//               <input value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }} placeholder="Search order ID, customer, phone…" style={{ ...inp, flex:1, minWidth:220 }}/>
//             </div>

//             {viewMode==="all"&&(
//               <>
//                 <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12 }}>
//                   <div style={{ display:"flex", alignItems:"center", gap:8 }}>
//                     <input type="date" value={startDate} onChange={e=>{ setStartDate(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", color:startDate?T1:T3 }}/>
//                     <span style={{ fontSize:12, color:T3 }}>to</span>
//                     <input type="date" value={endDate} min={startDate||undefined} onChange={e=>{ setEndDate(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", color:endDate?T1:T3 }}/>
//                     {(startDate||endDate)&&(
//                       <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", borderRadius:20, background:`${PINK}10`, border:`1px solid ${PINK}33`, fontSize:12, whiteSpace:"nowrap" }}>
//                         <span style={{ color:T2 }}>📦 <b style={{ color:T1 }}>{rangeStats.count}</b></span>
//                         <span style={{ color:T3 }}>|</span>
//                         <span style={{ color:T2 }}>💰 <b style={{ color:PINK }}>₹{fmt(rangeStats.amount)}</b></span>
//                       </div>
//                     )}
//                   </div>
//                   {[
//                     { val:filter, set:(v)=>{ setFilter(v); setPage(1); }, opts:STATUSES, label:"Status" },
//                     { val:typeF,  set:(v)=>{ setTypeF(v);  setPage(1); }, opts:["All","DINE_IN","TAKEAWAY"], label:"Type" },
//                     { val:payF,   set:(v)=>{ setPayF(v);   setPage(1); }, opts:["All","Paid","Pending","Failed"], label:"Payment" },
//                   ].map(f=>(
//                     <select key={f.label} value={f.val} onChange={e=>f.set(e.target.value)} style={{ ...inp, width:"auto", cursor:"pointer" }}>
//                       {f.opts.map(o=><option key={o} style={{ background:CARD }}>{o}</option>)}
//                     </select>
//                   ))}
//                 </div>
//                 <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
//                   {STATUSES.map(s=>{
//                     const cnt=s==="All"?orders.length:orders.filter(o=>o.status===s).length;
//                     const st=STATUS_STYLE[s]||{ bg:"rgba(107,114,128,0.15)", color:"#9ca3af" };
//                     const active=filter===s;
//                     return <button key={s} onClick={()=>{ setFilter(s); setPage(1); }} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:500, border:active?"none":`1px solid ${BDR}`, background:active?(s==="All"?PINK:st.bg):CARD2, color:active?(s==="All"?"#fff":st.color):T2 }}>{s} <span style={{ opacity:0.6 }}>({cnt})</span></button>;
//                   })}
//                   {hasFilters&&<button onClick={clearFilters} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, cursor:"pointer", border:`1px solid ${PINK}44`, color:PINK, background:CARD2, marginLeft:4 }}>Clear ✕</button>}
//                 </div>
//               </>
//             )}
//           </div>

//           {/* ── Orders table ── */}
//           <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:18 }}>
//             {loading?(
//               <div style={{ textAlign:"center", padding:48, color:T3 }}>Loading…</div>
//             ):displayedOrders.length===0?(
//               <div style={{ textAlign:"center", padding:48 }}>
//                 <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
//                 <div style={{ fontSize:14, color:T2 }}>{viewMode==="recent"?"No active orders today yet":"No orders match your filters"}</div>
//                 {viewMode==="all"&&hasFilters&&<button onClick={clearFilters} style={{ marginTop:12, padding:"8px 20px", borderRadius:20, border:`1px solid ${PINK}`, color:PINK, background:"transparent", cursor:"pointer" }}>Clear filters</button>}
//                 {viewMode==="recent"&&<button onClick={()=>{ setViewMode("all"); setPage(1); }} style={{ marginTop:12, padding:"8px 20px", borderRadius:20, border:`1px solid ${PINK}`, color:PINK, background:"transparent", cursor:"pointer" }}>View all orders</button>}
//               </div>
//             ):(
//               <>
//                 <div style={{ fontSize:12, color:T3, marginBottom:12 }}>
//                   Showing <span style={{ fontWeight:600, color:PINK }}>{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE,displayedOrders.length)}</span> of <span style={{ fontWeight:600, color:T1 }}>{displayedOrders.length}</span> {viewMode==="recent"?"active orders today":"orders"}
//                 </div>
//                 <div style={{ overflowX:"auto" }}>
             


// <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
//   <thead>
//     <tr>
//       {["Order","Customer","Items","Amount","Status","Payment","Date",""].map((h,i)=>(
//         <th key={i} style={{
//           textAlign:"left", padding:"9px 12px", fontSize:11,
//           color:T2, fontWeight:600, letterSpacing:0.5,
//           borderBottom:`1px solid ${BDR}`, whiteSpace:"nowrap",
//           ...(i===7 ? { width:150, minWidth:100 } : {})
//         }}>{h}</th>
//       ))}
//     </tr>
//   </thead>
//   <tbody>
//     {paginated.map(o=>{
//       const isOpen = expanded===o._id;
//       const displayName = o?.guestName || o.user?.name || "Guest";
//       const displayPhone = o.guestPhone || o.user?.phone || null;
//       const av = avc(displayName);
//       return (
//         <>
//           <tr key={o._id} style={{
//             borderBottom:isOpen?"none":`1px solid rgba(255,255,255,0.04)`,
//             background:isOpen?`${PINK}05`:"transparent",
//             transition:"background .15s",
//           }}
//             onMouseEnter={e=>!isOpen&&(e.currentTarget.style.background="rgba(139,92,246,0.04)")}
//             onMouseLeave={e=>!isOpen&&(e.currentTarget.style.background="transparent")}
//           >
//             {/* Order ID + Table combined */}
//             <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
//               <div style={{ fontWeight:600, color:PINK, fontSize:13 }}>{o.orderId}</div>
//               <div style={{ marginTop:3 }}>
//                 {o.tableNo
//                   ? <span style={{ background:`${PINK}18`, color:PINK, padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600 }}>T{o.tableNo}</span>
//                   : <span style={{ fontSize:11, color:T3 }}>Take Away</span>}
//               </div>
//             </td>

//             {/* Customer */}
//             <td style={{ padding:"10px 12px" }}>
//               <div style={{ display:"flex", alignItems:"center", gap:8 }}>
//                 <div style={{ width:28, height:28, borderRadius:"50%", background:av.bg, color:av.c, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, flexShrink:0 }}>{ini(displayName)}</div>
//                 <div>
//                   <div style={{ fontWeight:500, color:T1, fontSize:12 }}>{displayName}</div>
//                   {displayPhone && <div style={{ fontSize:11, color:T3 }}>+91 {displayPhone}</div>}
//                 </div>
//               </div>
//             </td>

//             {/* Items */}
//             <td style={{ padding:"10px 12px", maxWidth:160 }}>
//               <div style={{ fontSize:12, color:T2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
//                 {o.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")||"—"}
//               </div>
//             </td>

//             {/* Amount */}
//             <td style={{ padding:"10px 12px", fontWeight:700, color:T1, whiteSpace:"nowrap" }}>
//               ₹{Math.round(o.total)}
//             </td>

//             {/* Status + Type combined */}
//            <td style={{ padding:"10px 12px" }}>
//   <Badge label={o.status} map={STATUS_STYLE}/>
// </td>

//             {/* Payment */}
//          <td style={{ padding:"10px 12px" }}>
//   <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
//     <Badge label={o.paymentStatus} map={PAY_STYLE}/>
//     {o.paymentStatus !== "PENDING_VERIFICATION" && (
//       <span style={{ fontSize:10, color:T3 }}>{o.paymentMethod||"Cash"}</span>
//     )}
//   </div>
// </td>

//             {/* Date */}
//             <td style={{ padding:"10px 12px", fontSize:12, color:T3, whiteSpace:"nowrap" }}>
//               {new Date(o.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}
//               <div style={{ fontSize:11 }}>{new Date(o.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
//             </td>

//             {/* Actions — stacked vertically */}
//             <td style={{ padding:"8px 12px", width:95 }}>
//               <div style={{ display:"flex", flexDirection:"column", gap:4 }}>

//                 {/* View/Close */}
//                 <button onClick={()=>setExpanded(isOpen?null:o._id)} style={{
//                   padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
//                   cursor:"pointer", border:"none", width:"100%",
//                   background:isOpen?`${PINK}25`:CARD2,
//                   color:isOpen?PINK:T2,
//                 }}>
//                   {isOpen?"▲ Close":"▼ View"}
//                 </button>

//                 {/* Add Items */}
//                 {(o.status==="CONFIRMED"||o.status==="PREPARING"||o.status==="READY") && (
//                   <button onClick={()=>setShowAddItems(o._id)} style={{
//                     padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
//                     cursor:"pointer", border:"none", width:"100%",
//                     background:`${PINK}20`, color:PINK,
//                   }}>
//                     ＋ Add
//                   </button>
//                 )}

//                 {/* Print Bill */}
//                 <button onClick={async()=>{
//                   try{
//                     await printOrderBill(o._id);
//                     toast.success("Bill sent ✓");
//                   }catch(err){
//                     toast.error(err?.response?.data?.message||"Printer off");
//                   }
//                 }} style={{
//                   padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
//                   cursor:"pointer", border:"none", width:"100%",
//                   background:"rgba(16,185,129,0.2)", color:"#34d399",
//                 }}>
//                   🖨️ Bill
//                 </button>

//               </div>
//             </td>
//           </tr>

//           {isOpen && (
//             <tr key={`${o._id}-d`} style={{ borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
//               <td colSpan={8} style={{ padding:"4px 12px 16px" }}>
//                 <OrderDetail order={o}
//                   onStatusChange={(id,s)=>{ handleStatusChange(id,s); setExpanded(null); }}
//                   onPaymentChange={handlePaymentChange}
//                   onCombinedBill={(mode,value)=>setShowCombinedBill({mode,value})}
//                 />
//               </td>
//             </tr>
//           )}
//         </>
//       );
//     })}
//   </tbody>
// </table>
//                 </div>

//                 {totalPages>1&&(
//                   <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:16, flexWrap:"wrap" }}>
//                     <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${BDR}`, background:CARD2, color:page===1?T3:T1, cursor:page===1?"not-allowed":"pointer", fontSize:13 }}>← Prev</button>
//                     {Array.from({length:totalPages},(_,i)=>i+1).filter(p=>p===1||p===totalPages||Math.abs(p-page)<=1).reduce((acc,p,i,arr)=>{ if(i>0&&arr[i-1]!==p-1)acc.push("…"); acc.push(p); return acc; },[]).map((p,i)=>
//                       p==="…"?<span key={`e${i}`} style={{ padding:"6px 4px", fontSize:13, color:T3 }}>…</span>
//                       :<button key={p} onClick={()=>setPage(p)} style={{ padding:"6px 12px", borderRadius:8, fontSize:13, cursor:"pointer", border:"none", background:page===p?PINK:CARD2, color:page===p?"#fff":T1, fontWeight:page===p?600:400 }}>{p}</button>
//                     )}
//                     <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${BDR}`, background:CARD2, color:page===totalPages?T3:T1, cursor:page===totalPages?"not-allowed":"pointer", fontSize:13 }}>Next →</button>
//                   </div>
//                 )}
//               </>
//             )}
//           </div>
//         </div>

//         {/* ── RIGHT — Table Management ── */}
//        {showTables && (
// <div style={{ minWidth:0 }}>
//           <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:12, padding:14, position:"sticky", top:16 }}>
//    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
//   <div>
//     <div style={{ fontSize:15, fontWeight:700, color:T1 }}>Table Management</div>
//     <div style={{ fontSize:11, color:T3 }}>Tap a table to see its order</div>
//   </div>
//   <button onClick={()=>setShowTables(false)} style={{
//     padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600,
//     border:`1px solid ${BDR}`, background:CARD2, color:T2, cursor:"pointer",
//   }}>✕ Hide</button>
// </div>

//             {tablesLoading?(
//               <div style={{ textAlign:"center", padding:32, color:T3, fontSize:13 }}>Loading tables…</div>
//             ):tables.length===0?(
//               <div style={{ textAlign:"center", padding:32, color:T3, fontSize:13 }}>No tables yet</div>
//             ):(
//               <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(88px,1fr))", gap:10 }}>
//                 {/* {tables.slice().sort((a,b)=>a.tableNo-b.tableNo).map(t=>{
//                   const order=tableOrderMap[t.tableNo]||null;
//                   const occupied=!!order;
//                   const isSel=tableSelected===t.tableNo;
//                   const st=occupied?(STATUS_STYLE[order.status]||{ bg:"rgba(107,114,128,0.15)", color:"#9ca3af" }):null;
//                   return(
//                     <div key={t.tableNo} onClick={()=>setTableSelected(isSel?null:t.tableNo)} style={{ background:CARD2, border:`1px solid ${isSel?PINK:occupied?`${st.color}55`:BDR}`, borderRadius:12, padding:10, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:6, boxShadow:isSel?`0 0 0 3px ${PINK}22`:"none", transition:"all .15s" }}>
//                       <div style={{ width:"100%", aspectRatio:"1", borderRadius:9, background:occupied?st.bg:"rgba(255,255,255,0.03)", border:`1px solid ${occupied?`${st.color}44`:BDR}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:14, color:occupied?st.color:T2 }}>T{t.tableNo}</div>
//                       <div style={{ fontSize:10, color:T3, textAlign:"center", lineHeight:1.3 }}>{t.seats} seats</div>
//                       {occupied?<Badge label={order.status} map={STATUS_STYLE}/>:<span style={{ background:"rgba(16,185,129,0.15)", color:"#34d399", padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:500 }}>Free</span>}
//                       {occupied&&<div style={{ fontSize:10, fontWeight:700, color:st.color, fontFamily:"monospace" }}>₹{Math.round(order.total)}</div>}
//                     </div>
//                   );
//                 })} */}
//                 {tables
//   .slice()
//   .sort((a, b) => a.tableNo - b.tableNo)
//   .map((t) => {
//     const tableOrders = tableOrderMap[t.tableNo] || [];
//     const occupied = tableOrders.length > 0;
//     const isSel = tableSelected === t.tableNo;
//     const tableTotal = tableOrders.reduce((s, o) => s + Number(o.total || 0), 0);
 
//     let dominantStatus = null;
//     let st = null;
//     if (occupied) {
//       const statusCounts = {};
//       tableOrders.forEach((o) => {
//         statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
//       });
//       dominantStatus = Object.keys(statusCounts).sort((a, b) => statusCounts[b] - statusCounts[a])[0];
//       st = STATUS_STYLE[dominantStatus] || { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" };
//     }
 
//     return (
//       <div
//         key={t.tableNo}
//         onClick={() => setTableSelected(isSel ? null : t.tableNo)}
//         style={{
//           background: CARD2,
//           border: `1px solid ${isSel ? PINK : occupied ? `${st.color}55` : BDR}`,
//           borderRadius: 12,
//           padding: 12,
//           cursor: "pointer",
//           display: "flex",
//           flexDirection: "column",
//           alignItems: "center",
//           gap: 8,
//           boxShadow: isSel ? `0 0 0 3px ${PINK}22` : "none",
//           transition: "all .15s",
//         }}
//       >
//         <div
//           style={{
//             width: "100%",
//             aspectRatio: "1",
//             borderRadius: 9,
//             background: occupied ? st.bg : "rgba(255,255,255,0.03)",
//             border: `1px solid ${occupied ? `${st.color}44` : BDR}`,
//             display: "flex",
//             alignItems: "center",
//             justifyContent: "center",
//             fontWeight: 700,
//             fontSize: 18,
//             color: occupied ? st.color : T2,
//             position: "relative",
//           }}
//         >
//           T{t.tableNo}
//           {occupied && (
//             <div
//               style={{
//                 position: "absolute",
//                 top: -8,
//                 right: -8,
//                 background: PINK,
//                 color: "#fff",
//                 borderRadius: "50%",
//                 width: 24,
//                 height: 24,
//                 display: "flex",
//                 alignItems: "center",
//                 justifyContent: "center",
//                 fontSize: 11,
//                 fontWeight: 700,
//               }}
//             >
//               {tableOrders.length}
//             </div>
//           )}
//         </div>
 
//         <div style={{ fontSize: 10, color: T3, textAlign: "center" }}>{t.seats} seats</div>
 
//         {occupied ? (
//           <>
//             <Badge label={dominantStatus} map={STATUS_STYLE} />
//             <div style={{ fontSize: 11, fontWeight: 700, color: st.color, fontFamily: "monospace", textAlign: "center" }}>
//               ₹{Math.round(tableTotal)}
//             </div>
//             <div style={{ fontSize: 9, color: T3, textAlign: "center" }}>
//               {tableOrders.reduce((s, o) => s + (o.items?.length || 0), 0)} items
//             </div>
//           </>
//         ) : (
//           <span style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
//             Free
//           </span>
//         )}
//       </div>
//     );
//   })}
//               </div>
//             )}

//             {/* {tableSelected&&(
//               selectedTableOrder?(
//                 <div style={{ marginTop:14 }}>
//                   <OrderDetail order={selectedTableOrder}
//                     onStatusChange={(id,s)=>{ handleStatusChange(id,s); setTableSelected(null); }}
//                     onPaymentChange={handlePaymentChange}
//                   />
//                 </div>
//               ):(
//                 <div style={{ marginTop:14, textAlign:"center", padding:20, color:T3, fontSize:12, border:`1px dashed ${BDR}`, borderRadius:10 }}>
//                   Table {tableSelected} is free
//                 </div>
//               )
//             )} */}
//            {tableSelected && (
//   <MultiOrderTableView
//     orders={selectedTableOrders}
//     tableNo={tableSelected}
//     onStatusChange={(id,s)=>{ handleStatusChange(id,s); setTableSelected(null); }}
//     onPaymentChange={handlePaymentChange}
//     onCombinedBill={(mode,value)=>setShowCombinedBill({mode,value})} // ← ADD
//     onAddItems={(order)=>setShowAddItems(order._id)}
//   />
// )}
//           </div>
//         </div>
//        )}

//       </div>

//     {showCreate&&<CreateOrderModal onClose={()=>setShowCreate(false)} onCreated={o=>setOrders(prev=>[o,...prev])}/>}

// {showAddItems && (
//   <AddItemsToOrderModal
//     order={orders.find((o) => o._id === showAddItems)}
//     onClose={() => setShowAddItems(null)}
//     onItemsAdded={(updatedOrder) => {
//       setOrders((prev) =>
//         prev.map((o) =>
//           o._id === updatedOrder._id ? updatedOrder : o
//         )
//       );
//     }}
//   />
// )}
// {showCombinedBill && (
//       <CombinedBillModal
//         mode={showCombinedBill.mode}
//         value={showCombinedBill.value}
//         onClose={()=>setShowCombinedBill(null)}
//         onPaymentChange={fetchOrders}
//       />
//     )}
//     </div>
//   );
// }
import { PRIMARY } from "../../theme.js";
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import toast from "react-hot-toast";
import {
  getAllOrders, getRestaurantProfile, updateOrderStatus,
  getAllTables, updateInvoiceStatus, printOrderBill
} from "../../services/adminService.js";
import { placeOrder } from "../../services/orderService.js";
import CombinedBillModal from "./shared/CombinedBillModal.jsx";
import { getMenu, getCategories } from "../../services/menuService.js";

// ── add this to adminService.js if not already there ─────────────────────────
// export const updateOrderPayment = (id, data) => api.patch(`/admin/orders/${id}/payment`, data);

const PINK  = PRIMARY;
const CARD  = "#16132a";
const CARD2 = "#1c1830";
const BDR   = "rgba(255,255,255,0.07)";
const T1    = "#f1f0f5";
const T2    = "#9ca3af";
const T3    = "#4b5563";
const RADIUS = 14;

// ── Style lookup tables ────────────────────────────────────────────────────
// IMPORTANT: keys here must exactly match the raw values stored on the order
// (uppercase, underscore-separated), not display text. Formatting for display
// happens separately via the format* helpers + Badge's `format` prop.
const DEFAULT_STATUS_STYLE = { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" };

const STATUS_STYLE = {
  PENDING_CONFIRMATION: { bg: "rgba(156,163,175,0.15)", color: "#d1d5db" },
  CONFIRMED:            { bg: "rgba(56,122,221,0.15)",  color: "#60a5fa" },
  PREPARING:            { bg: "rgba(186,117,23,0.15)",  color: "#fbbf24" },
  READY:                { bg: "rgba(16,185,129,0.15)",  color: "#34d399" },
  DELIVERED:            { bg: "rgba(16,185,129,0.15)",  color: "#34d399" },
  COMPLETED:            { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" },
  CANCELLED:            { bg: "rgba(239,68,68,0.15)",   color: "#f87171" },
};

const PAY_STYLE = {
  PAID:                 { bg: "rgba(16,185,129,0.15)", color: "#34d399" },
  PENDING_VERIFICATION: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
  FAILED:               { bg: "rgba(239,68,68,0.15)",  color: "#f87171" },
};

const TYPE_STYLE = {
  DINE_IN:  { bg: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
  TAKEAWAY: { bg: "rgba(59,130,246,0.15)", color: "#93c5fd" },
};

const STATUSES = ["All","PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"];
const ACTIVE_ORDER_STATUSES = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
const PAYMENT_STATUSES = ["All","PAID","PENDING_VERIFICATION","FAILED"];
const ORDER_TYPES = ["All","DINE_IN","TAKEAWAY"];

const AVATAR_COLORS = [
  { bg:"rgba(139,92,246,0.2)", c:"#c4b5fd" },
  { bg:"rgba(16,185,129,0.2)", c:"#6ee7b7" },
  { bg:"rgba(59,130,246,0.2)", c:"#93c5fd" },
  { bg:"rgba(245,158,11,0.2)", c:"#fcd34d" },
  { bg:"rgba(239,68,68,0.2)",  c:"#fca5a5" },
  { bg:"rgba(236,72,153,0.2)", c:"#f9a8d4" },
];
const CATEGORY_ORDER = [
  "pizza","burger","snack","french fry","momo","sandwich",
  "beverage","mocktail","biscuit","cake","extra",
];

const normalizeCategory = (s) => (s || "").trim().toLowerCase();
const getCategoryRank = (cat) => {
  const n = normalizeCategory(cat);
  const idx = CATEGORY_ORDER.findIndex((key) => n.includes(key));
  return idx === -1 ? CATEGORY_ORDER.length : idx;
};

const avc = (n) => AVATAR_COLORS[(n?.charCodeAt(0)||0) % AVATAR_COLORS.length];
const ini = (n) => !n||n==="Guest" ? "G" : n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const inp = { padding:"9px 12px", borderRadius:10, border:`1px solid ${BDR}`, fontSize:13, outline:"none", background:CARD2, color:T1, width:"100%", boxSizing:"border-box" };
const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

// ── Display formatters (keep raw values for logic, format only for text) ───
const formatStatus = (s="") =>
  s.replace(/_/g," ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const formatPayment = (s) => ({ PAID:"Paid", PENDING_VERIFICATION:"Pending", FAILED:"Failed" }[s] || formatStatus(s));
const formatOrderType = (s) => ({ DINE_IN:"Dine In", TAKEAWAY:"Takeaway", All:"All" }[s] || formatStatus(s));

// ── Shared hover / transition styles injected once ─────────────────────────
const GlobalOrdersStyle = () => (
  <style>{`
    .op-card { transition: box-shadow .2s ease, border-color .2s ease; }
    .op-card:hover { border-color: rgba(255,255,255,0.12); }
    .op-stat { transition: transform .15s ease, box-shadow .15s ease; }
    .op-stat:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.35); }
    .op-row { transition: background .15s ease; }
    .op-row:hover { background: rgba(139,92,246,0.06); }
    .op-btn { transition: filter .15s ease, transform .1s ease; }
    .op-btn:hover { filter: brightness(1.08); }
    .op-btn:active { transform: scale(0.98); }
    .op-chip { transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .op-menu-card { transition: border-color .15s ease, background .15s ease, transform .1s ease; }
    .op-menu-card:hover { border-color: ${PINK}66; }
    .op-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .op-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
    .op-scroll::-webkit-scrollbar-track { background: transparent; }
  `}</style>
);

// ── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ label, map, format }) => {
  const s = map[label] || DEFAULT_STATUS_STYLE;
  return (
    <span style={{ background:s.bg, color:s.color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
      {format ? format(label) : label}
    </span>
  );
};

// ── StatPill ──────────────────────────────────────────────────────────────────
const StatPill = ({ label, value, color, sub, icon }) => (
  <div className="op-card op-stat" style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:RADIUS, padding:"14px 16px", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:0, right:0, width:56, height:56, background:`${color||PINK}14`, borderRadius:"0 14px 0 56px" }}/>
    {icon && (
      <div style={{ width:30, height:30, borderRadius:9, background:`${color||PINK}1f`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, marginBottom:8 }}>
        {icon}
      </div>
    )}
    <div style={{ fontSize:11, color:T2, marginBottom:4, fontWeight:500 }}>{label}</div>
    <div style={{ fontSize:21, fontWeight:700, color:color||T1, letterSpacing:-0.3 }}>{value}</div>
    {sub && <div style={{ fontSize:11, color:T3, marginTop:3 }}>{sub}</div>}
  </div>
);

// ── OrderDetail ───────────────────────────────────────────────────────────────
const OrderDetail = ({ order, onStatusChange, onPaymentChange, onCombinedBill }) => {
  const subtotal = order.items?.reduce((s,i)=>s+i.price*i.qty,0)||0;
  const displayName = order.user?.name || order.guestName || "Guest";
  const displayPhone = order.guestPhone||order.user?.phone  || null;

  return (
    <div style={{ background:CARD2, borderRadius:RADIUS, padding:16,
      border:`1px solid rgba(139,92,246,0.15)`,
      display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
      gap:16, marginTop:2 }}>

      {/* Items */}
      <div>
        <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Items ordered</div>
        {order.items?.map((item,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${BDR}`, fontSize:13 }}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ width:24, height:24, borderRadius:6, background:`${PINK}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:600, color:PINK }}>{item.qty}</div>
              <span style={{ color:T1 }}>{item.name}</span>
            </div>
            <span style={{ fontWeight:500, color:T1 }}>₹{item.price*item.qty}</span>
          </div>
        ))}
        <div style={{ borderTop:`1px solid ${BDR}`, marginTop:10, paddingTop:10 }}>
          {[
            { l:"Subtotal", v:`₹${subtotal}` },
            ...(order.serviceCharge>0?[{ l:"Service Charge", v:`₹${order.serviceCharge}` }]:[]),
            ...(order.tax>0?[{ l:"GST", v:`₹${order.tax}` }]:[]),
          ].map(r=>(
            <div key={r.l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2, marginBottom:5 }}>
              <span>{r.l}</span><span>{r.v}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:15, marginTop:8 }}>
            <span style={{ color:T1 }}>Total</span>
            <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
          </div>
        </div>
      </div>

      {/* Info + Status + Payment */}
      <div>
        <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>Order info</div>
        {[
          { l:"Order ID", v:order.orderId,                    vc:PINK },
          { l:"Customer", v:displayName                               },
          { l:"Phone",    v:displayPhone?`+91 ${displayPhone}`:"—"   },
          { l:"Type",     v:formatOrderType(order.orderType)          },
          { l:"Table",    v:order.tableNo?`T${order.tableNo}`:"—"    },
          { l:"Date",     v:new Date(order.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) },
        ].map(r=>(
          <div key={r.l} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid rgba(255,255,255,0.05)`, fontSize:13 }}>
            <span style={{ color:T2 }}>{r.l}</span>
            <span style={{ fontWeight:500, color:r.vc||T1 }}>{r.v}</span>
          </div>
        ))}

        {/* Order Status update */}
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Update Order Status</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {STATUSES.filter(s=>s!=="All").filter(s=>s!==order.status).map(s=>{
                const st = STATUS_STYLE[s] || DEFAULT_STATUS_STYLE;
                return (
                  <button key={s} className="op-chip" onClick={()=>onStatusChange(order._id,s)}
                    style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${st.color}44`, background:st.bg, color:st.color, cursor:"pointer", fontSize:12, fontWeight:500 }}>
                    {formatStatus(s)}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Payment Status update */}
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Payment Status</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {["PENDING_VERIFICATION","PAID","FAILED"].map(s=>{
              const st = PAY_STYLE[s] || DEFAULT_STATUS_STYLE;
              const active=order.paymentStatus===s;
              return (
                <button key={s} className="op-chip" onClick={()=>!active&&onPaymentChange(order._id,{ paymentStatus:s })}
                  style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:active?"default":"pointer",
                    border:`1px solid ${active?st.color+"88":st.color+"44"}`,
                    background:active?st.bg:"transparent",
                    color:st.color, opacity:active?1:0.6 }}>
                  {active?"✓ ":""}{formatPayment(s)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment Method update */}
        <div style={{ marginTop:10 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Payment Method</div>
          <div style={{ display:"flex", gap:6 }}>
            {["Cash","Online"].map(m=>{
              const active=order.paymentMethod===m;
              return (
                <button key={m} className="op-chip" onClick={()=>!active&&onPaymentChange(order._id,{ paymentMethod:m })}
                  style={{ padding:"6px 16px", borderRadius:20, fontSize:12, fontWeight:600, cursor:active?"default":"pointer",
                    border:`2px solid ${active?PINK:BDR}`,
                    background:active?`${PINK}15`:CARD2,
                    color:active?PINK:T2 }}>
                  {m==="Cash"?"💵":"📱"} {m}
                </button>
              );
            })}
          </div>
        </div>

         {(order.guestPhone || order.user?.phone) && (
          <button className="op-btn" onClick={()=>onCombinedBill?.("phone", order.guestPhone||order.user?.phone)}
            style={{ marginTop:12, padding:"7px 14px", borderRadius:20,
              border:`1px solid ${PINK}44`, background:`${PINK}10`,
              color:PINK, cursor:"pointer", fontSize:12, fontWeight:600 }}>
            🧾 View all orders for this customer
          </button>
        )}
      </div>
    </div>
  );
};

// ── ItemImage ─────────────────────────────────────────────────────────────────
const isUrl = (s) => typeof s==="string"&&s.startsWith("http");
const ItemImage = ({ src, name }) => isUrl(src)
  ? <img src={src} alt={name} onError={e=>e.target.style.display="none"} style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
  : <span style={{ fontSize:24, flexShrink:0 }}>{src||"🍽️"}</span>;

// ── CreateOrderModal — KFC-style rush ordering ────────────────────────────────
const ORDER_TYPE_OPTIONS = [
  { value:"DINE_IN",  label:"Dining",   icon:"🪑" },
  { value:"TAKEAWAY", label:"Take Away", icon:"🛍️" },
];
const PAYMENT_STATUS_OPTIONS = [
  { value:"PENDING_VERIFICATION", label:"Due",  icon:"⏳" },
  { value:"PAID",                 label:"Paid", icon:"✓"  },
];

const CreateOrderModal = ({ onClose, onCreated }) => {
  const [vegFilter,  setVegFilter]  = useState("All");
  const [tempFilter, setTempFilter] = useState("All");
  const [mi,          setMi]          = useState([]);
  const [selCat,      setSelCat]      = useState("All");
  const [search,      setSearch]      = useState("");
  const [cart,        setCart]        = useState([]);
  const [orderType,   setOrderType]   = useState("DINE_IN");
  const [tableNo,     setTableNo]     = useState("");
  const [customerName,setCustomerName]= useState("");
  const [customerPhone,setCustomerPhone]=useState("");
  const [paymentMethod,setPaymentMethod]=useState("Cash");
  const [paymentStatus,setPaymentStatus]=useState("PENDING_VERIFICATION");
  const [loading,     setLoading]     = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [scpi,        setScpi]        = useState(0);
  const [gstRate,     setGstRate]     = useState(0);
  const [catImages, setCatImages] = useState({});

  useEffect(()=>{
    getMenu({}).then(r=>{ setMi(r.data||[]); setMenuLoading(false); }).catch(()=>setMenuLoading(false));
    getRestaurantProfile().then(r=>{ const p=r.data?.data||r.data; setScpi(p?.serviceCharge||0); setGstRate(p?.gstRate||0); }).catch(()=>{});
    getCategories().then(r=>{
      const list = r.data?.data || r.data || [];
      const map = {};
      list.forEach(c=>{ if(c.name && c.image) map[c.name] = c.image; });
      setCatImages(map);
    }).catch(()=>{});
  },[]);

  const COLD_CATS = ["Mocktail","Cold Coffee","Shake","Juice","Lassi","Cold Drinks"];
  const HOT_CATS  = ["Tea","Coffee","Hot Drinks","Soup"];
  const BEV_CATS  = [...COLD_CATS, ...HOT_CATS, "Drinks","Beverages"];
  const isBeverageCat = BEV_CATS.includes(selCat);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(mi.map(m=>m.category).filter(Boolean)));
    const sorted = [...unique].sort((a,b) => getCategoryRank(a) - getCategoryRank(b));
    return ["All", ...sorted];
  }, [mi]);

  const filtered = mi.filter(m=>{
    const matchCat    = selCat==="All" || m.category===selCat;
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchVeg    = vegFilter==="All" || m.tag===vegFilter;
    const matchTemp   = tempFilter==="All"
      || (tempFilter==="Cold" && COLD_CATS.includes(m.category))
      || (tempFilter==="Hot"  && HOT_CATS.includes(m.category));
    return matchCat && matchSearch && matchVeg && matchTemp;
  });

  const getQty    = (id) => cart.find(c=>c.item._id===id)?.qty||0;
  const addItem   = (item) => setCart(p=>{ const ex=p.find(c=>c.item._id===item._id); return ex?p.map(c=>c.item._id===item._id?{...c,qty:c.qty+1}:c):[...p,{item,qty:1}]; });
  const removeItem= (id)  => setCart(p=>{ const ex=p.find(c=>c.item._id===id); if(!ex)return p; return ex.qty===1?p.filter(c=>c.item._id!==id):p.map(c=>c.item._id===id?{...c,qty:c.qty-1}:c); });
  const clearCart = () => setCart([]);

  const totalQty  = cart.reduce((s,c)=>s+c.qty,0);
  const subtotal  = cart.reduce((s,c)=>s+c.item.price*c.qty,0);
  const tax       = Math.round(subtotal*(gstRate/100));
  const scAmt     = scpi * totalQty;
  const total     = subtotal + tax + scAmt;

  const handleSubmit = async () => {
    if(!cart.length) return toast.error("Add at least one item");
    if(orderType==="DINE_IN" && !tableNo) return toast.error("Enter table number");
    try{
      setLoading(true);
      const { data } = await placeOrder({
        items: cart.map(c=>({ menuItemId:c.item._id, qty:c.qty })),
        orderType, tableNo: orderType==="DINE_IN" ? Number(tableNo) : null,
        isGuest: true,
        customerName:  customerName.trim()||undefined,
        customerPhone: customerPhone.trim()||undefined,
        paymentMethod, paymentStatus,
      });
      toast.success(`✓ Order ${data.orderId} placed!`);
      onCreated(data); onClose();
    }catch(e){ toast.error(e.response?.data?.message||"Failed"); }
    finally{ setLoading(false); }
  };

  const CAT_ICONS = {
    All:"🍽️", Biryani:"🍛", Burger:"🍔", Pizza:"🍕", Shake:"🥤",
    Mocktail:"🍹", Coffee:"☕", Tea:"🍵", Dessert:"🍨", Snacks:"🍟",
    Drinks:"🧃", Juice:"🍊", Lassi:"🥛", Noodles:"🍜", Rice:"🍚",
  };

  const getCatIcon = (cat) => {
    if (catImages[cat]) return catImages[cat];
    return CAT_ICONS[cat] || "🍽️";
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:999,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:12, backdropFilter:"blur(6px)", fontFamily:"'DM Sans',sans-serif" }}>

      <div style={{ background:"#0f0e1a", borderRadius:20, width:"100%", maxWidth:1300,
        height:"92vh", display:"flex", flexDirection:"column",
        border:`1px solid rgba(139,92,246,0.25)`,
        boxShadow:"0 30px 80px rgba(0,0,0,0.8)", overflow:"hidden" }}>

        {/* ── TOP BAR — search only ── */}
        <div style={{ display:"flex", alignItems:"center", gap:12,
          padding:"14px 20px", borderBottom:`1px solid ${BDR}`,
          background:"#13111f", flexShrink:0 }}>

          <div style={{ flex:1, display:"flex", alignItems:"center", gap:8,
            background:CARD2, border:`1px solid ${BDR}`, borderRadius:10,
            padding:"7px 14px" }}>
            <span style={{ fontSize:16 }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search items..."
              style={{ flex:1, background:"transparent", border:"none",
                outline:"none", fontSize:13, color:T1 }}/>
            {search && <button onClick={()=>setSearch("")}
              style={{ background:"none", border:"none", color:T3,
                cursor:"pointer", fontSize:14 }}>✕</button>}
          </div>

          <button className="op-btn" onClick={onClose} style={{ width:34, height:34, borderRadius:"50%",
            border:`1px solid ${BDR}`, background:CARD, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:T2, fontSize:16, flexShrink:0 }}>✕</button>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* ── LEFT: Category tabs (vertical) ── */}
          <div className="op-scroll" style={{ width:150, background:"#0a0913",
            borderRight:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column",
            overflowY:"auto", flexShrink:0 }}>
            {categories.map(cat=>{
              const active = selCat===cat;
              const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
              return (
                <button key={cat} onClick={()=>setSelCat(cat)} style={{
                  padding:"14px 8px", border:"none", cursor:"pointer",
                  background:active?`${PINK}18`:"transparent",
                  borderLeft:active?`3px solid ${PINK}`:"3px solid transparent",
                  display:"flex", flexDirection:"column",
                  alignItems:"center", gap:4, transition:"all .15s",
                }}>
                  {(() => {
                    const icon = getCatIcon(cat);
                    return icon?.startsWith?.("http")
                      ? <img src={icon} alt={cat}
                          onError={e=>e.target.style.display="none"}
                          style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/>
                      : <span style={{ fontSize:22 }}>{icon}</span>;
                  })()}
                  <span style={{ fontSize:10, fontWeight:active?700:500,
                    color:active?PINK:T2, textAlign:"center",
                    lineHeight:1.2, wordBreak:"break-word" }}>
                    {cat}
                  </span>
                  <span style={{ fontSize:9, color:T3 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* ── MIDDLE: Menu items grid ── */}
          <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:16 }}>

            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
              <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
                borderRadius:20, border:`1px solid ${BDR}` }}>
                {[["All","🍽️ All"],["Veg","🟢 Veg"],["Non Veg","🔴 Non Veg"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setVegFilter(v)} style={{
                    padding:"5px 12px", borderRadius:16, border:"none",
                    cursor:"pointer", fontSize:12, fontWeight:600,
                    background:vegFilter===v
                      ? (v==="Veg"?"rgba(22,163,74,0.3)"
                        : v==="Non Veg"?"rgba(239,68,68,0.3)"
                        : PINK)
                      : "transparent",
                    color:vegFilter===v
                      ? (v==="Veg"?"#4ade80"
                        : v==="Non Veg"?"#f87171"
                        : "#fff")
                      : T2,
                    transition:"all .15s",
                  }}>{label}</button>
                ))}
              </div>

              {(isBeverageCat || selCat==="All") && (
                <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
                  borderRadius:20, border:`1px solid ${BDR}` }}>
                  {[["All","All"],["Hot","🔥 Hot"],["Cold","🧊 Cold"]].map(([v,label])=>(
                    <button key={v} onClick={()=>setTempFilter(v)} style={{
                      padding:"5px 12px", borderRadius:16, border:"none",
                      cursor:"pointer", fontSize:12, fontWeight:600,
                      background:tempFilter===v
                        ? (v==="Hot"?"rgba(234,88,12,0.3)"
                          : v==="Cold"?"rgba(59,130,246,0.3)"
                          : PINK)
                        : "transparent",
                      color:tempFilter===v
                        ? (v==="Hot"?"#fb923c"
                          : v==="Cold"?"#60a5fa"
                          : "#fff")
                        : T2,
                    }}>{label}</button>
                  ))}
                </div>
              )}

              <span style={{ fontSize:12, color:T3, alignSelf:"center" }}>
                {filtered.length} item{filtered.length!==1?"s":""}
              </span>
            </div>

            {menuLoading ? (
              <div style={{ textAlign:"center", padding:60, color:T3 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
                Loading menu...
              </div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:60, color:T3 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                No items found
              </div>
            ) : (
              <div style={{ display:"grid",
                gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",
                gap:12 }}>
                {filtered.map(m=>{
                  const qty = getQty(m._id);
                  const inCart = qty > 0;
                  return (
                    <div key={m._id} className="op-menu-card" style={{
                      background:inCart?`${PINK}12`:CARD2,
                      border:`2px solid ${inCart?PINK:BDR}`,
                      borderRadius:RADIUS, overflow:"hidden",
                      cursor:"pointer",
                      display:"flex", flexDirection:"column",
                      position:"relative",
                    }}>
                      <div style={{ height:100, background:"#1a1625",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        overflow:"hidden", flexShrink:0 }}>
                        {m.image?.startsWith("http")
                          ? <img src={m.image} alt={m.name}
                              onError={e=>e.target.style.display="none"}
                              style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                          : <span style={{ fontSize:42 }}>🍽️</span>
                        }
                      </div>

                      {inCart && (
                        <div style={{ position:"absolute", top:8, right:8,
                          background:PINK, color:"#fff", borderRadius:"50%",
                          width:24, height:24, display:"flex",
                          alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700 }}>{qty}</div>
                      )}

                      <div style={{ padding:"10px 10px 6px", flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:T1,
                          lineHeight:1.3, marginBottom:3 }}>{m.name}</div>
                        <div style={{ fontSize:11, color:T3 }}>{m.category}</div>
                        <div style={{ fontWeight:700, fontSize:15, color:PINK,
                          marginTop:4 }}>₹{m.price}</div>
                      </div>

                      <div style={{ padding:"0 8px 10px",
                        display:"flex", alignItems:"center", gap:6 }}>
                        {qty===0 ? (
                          <button className="op-btn" onClick={()=>addItem(m)} style={{
                            flex:1, padding:"8px 0", borderRadius:10,
                            background:`linear-gradient(135deg,${PINK},#5b21b6)`,
                            color:"#fff", border:"none", cursor:"pointer",
                            fontWeight:700, fontSize:13,
                          }}>+ Add</button>
                        ) : (
                          <>
                            <button onClick={()=>removeItem(m._id)} style={{
                              width:32, height:32, borderRadius:"50%",
                              border:`2px solid ${PINK}`, background:"transparent",
                              color:PINK, cursor:"pointer", fontWeight:700,
                              fontSize:18, display:"flex", alignItems:"center",
                              justifyContent:"center",
                            }}>−</button>
                            <span style={{ flex:1, textAlign:"center",
                              fontWeight:700, fontSize:16, color:T1 }}>{qty}</span>
                            <button onClick={()=>addItem(m)} style={{
                              width:32, height:32, borderRadius:"50%",
                              background:PINK, color:"#fff", border:"none",
                              cursor:"pointer", fontWeight:700, fontSize:18,
                              display:"flex", alignItems:"center",
                              justifyContent:"center",
                            }}>+</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT: Cart + Order details ── */}
          <div style={{ width:280, background:"#13111f",
            borderLeft:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column", flexShrink:0 }}>

            {/* Cart header */}
            <div style={{ padding:"14px 14px 10px",
              borderBottom:`1px solid ${BDR}`, flexShrink:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center" }}>
                <div style={{ fontWeight:700, fontSize:15, color:T1 }}>
                  🛒 Cart
                  {totalQty>0 && <span style={{ marginLeft:8, background:PINK,
                    color:"#fff", borderRadius:"50%", width:20, height:20,
                    display:"inline-flex", alignItems:"center",
                    justifyContent:"center", fontSize:11, fontWeight:700,
                  }}>{totalQty}</span>}
                </div>
                {cart.length>0 && (
                  <button onClick={clearCart} style={{ background:"none",
                    border:"none", color:"#f87171", cursor:"pointer",
                    fontSize:12, fontWeight:600 }}>Clear</button>
                )}
              </div>
            </div>

            {/* Order details */}
            <div style={{ padding:"12px 14px", borderBottom:`1px solid ${BDR}`,
              flexShrink:0, display:"flex", flexDirection:"column", gap:8 }}>

              {/* Order type */}
              <div style={{ display:"flex", gap:6, background:CARD2, padding:4,
                borderRadius:10, border:`1px solid ${BDR}` }}>
                {ORDER_TYPE_OPTIONS.map(({value,label,icon})=>(
                  <button key={value} onClick={()=>setOrderType(value)} style={{
                    flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                    fontWeight:700, fontSize:12, border:"none",
                    background:orderType===value?PINK:"transparent",
                    color:orderType===value?"#fff":T2, transition:"all .15s",
                  }}>{icon} {label}</button>
                ))}
              </div>

              {/* Table number — only for Dining */}
              {orderType==="DINE_IN" && (
                <div style={{ display:"flex", alignItems:"center", gap:8,
                  background:CARD2, border:`1px solid ${tableNo?PINK:BDR}`,
                  borderRadius:10, padding:"6px 14px" }}>
                  <span style={{ fontSize:13, color:T2, fontWeight:500 }}>Table</span>
                  <input type="number" min={1} value={tableNo}
                    onChange={e=>setTableNo(e.target.value)}
                    placeholder="No."
                    style={{ flex:1, background:"transparent", border:"none",
                      outline:"none", fontSize:15, fontWeight:700, color:T1,
                      textAlign:"center" }}/>
                </div>
              )}

              {/* Customer name */}
              <input value={customerName} onChange={e=>setCustomerName(e.target.value)}
                placeholder="Customer name"
                style={inp}/>

              {/* Customer phone */}
              <input value={customerPhone}
                onChange={e=>setCustomerPhone(e.target.value.replace(/\D/g,""))}
                maxLength={10} placeholder="Phone number"
                style={inp}/>

              {/* Payment Method */}
              <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
                borderRadius:8, border:`1px solid ${BDR}` }}>
                {["Cash","Online"].map(m=>(
                  <button key={m} onClick={()=>setPaymentMethod(m)} style={{
                    flex:1, padding:"6px 0", borderRadius:6, cursor:"pointer",
                    fontWeight:600, fontSize:12, border:"none",
                    background:paymentMethod===m?PINK:"transparent",
                    color:paymentMethod===m?"#fff":T2,
                  }}>{m==="Cash"?"💵 Cash":"📱 Online"}</button>
                ))}
              </div>

              {/* Payment Status */}
              <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
                borderRadius:8, border:`1px solid ${BDR}` }}>
                {PAYMENT_STATUS_OPTIONS.map(({value,label,icon})=>{
                  const st = PAY_STYLE[value] || DEFAULT_STATUS_STYLE;
                  const active = paymentStatus===value;
                  return (
                    <button key={value} onClick={()=>setPaymentStatus(value)} style={{
                      flex:1, padding:"6px 0", borderRadius:6, cursor:"pointer",
                      fontWeight:600, fontSize:12, border:"none",
                      background:active?st.bg:"transparent",
                      color:active?st.color:T2,
                    }}>{icon} {label}</button>
                  );
                })}
              </div>

              {/* WhatsApp notice */}
              {customerPhone?.length===10 && (
                <span style={{ fontSize:11, color:"#34d399" }}>
                  📱 Will notify +91 {customerPhone}
                </span>
              )}
            </div>

            {/* Cart items */}
            <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:"10px 14px" }}>
              {cart.length===0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:T3 }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>🛒</div>
                  <div style={{ fontSize:13 }}>No items yet</div>
                  <div style={{ fontSize:11, marginTop:4 }}>Tap items to add</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {cart.map(c=>(
                    <div key={c.item._id} style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"8px 10px", borderRadius:10,
                      background:CARD, border:`1px solid ${BDR}`,
                    }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:T1,
                          overflow:"hidden", textOverflow:"ellipsis",
                          whiteSpace:"nowrap" }}>{c.item.name}</div>
                        <div style={{ fontSize:11, color:T3 }}>
                          ₹{c.item.price} × {c.qty}
                        </div>
                      </div>
                      <div style={{ fontWeight:700, color:PINK, fontSize:13,
                        minWidth:44, textAlign:"right" }}>
                        ₹{c.item.price*c.qty}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <button onClick={()=>removeItem(c.item._id)} style={{
                          width:24, height:24, borderRadius:"50%",
                          border:`1.5px solid ${BDR}`, background:CARD2,
                          color:T2, cursor:"pointer", fontWeight:700,
                          fontSize:14, display:"flex", alignItems:"center",
                          justifyContent:"center",
                        }}>−</button>
                        <button onClick={()=>addItem(c.item)} style={{
                          width:24, height:24, borderRadius:"50%",
                          background:PINK, color:"#fff", border:"none",
                          cursor:"pointer", fontWeight:700, fontSize:14,
                          display:"flex", alignItems:"center",
                          justifyContent:"center",
                        }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bill summary + Place order */}
            {cart.length>0 && (
              <div style={{ padding:"12px 14px 16px",
                borderTop:`1px solid ${BDR}`, flexShrink:0 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:5,
                  marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    fontSize:12, color:T2 }}>
                    <span>Subtotal</span><span>₹{subtotal}</span>
                  </div>
                  {tax>0 && <div style={{ display:"flex",
                    justifyContent:"space-between", fontSize:12, color:T2 }}>
                    <span>GST ({gstRate}%)</span><span>₹{tax}</span>
                  </div>}
                  {scAmt>0 && <div style={{ display:"flex",
                    justifyContent:"space-between", fontSize:12, color:T2 }}>
                    <span>Service</span><span>₹{scAmt}</span>
                  </div>}
                  <div style={{ display:"flex", justifyContent:"space-between",
                    fontWeight:700, fontSize:17, paddingTop:8,
                    borderTop:`1px solid ${BDR}`, marginTop:4 }}>
                    <span style={{ color:T1 }}>Total</span>
                    <span style={{ color:PINK }}>₹{total}</span>
                  </div>
                </div>

                <button className="op-btn" onClick={handleSubmit}
                  disabled={loading||cart.length===0}
                  style={{ width:"100%", padding:"14px 0", borderRadius:14,
                    border:"none",
                    background:loading||cart.length===0
                      ?"#374151"
                      :`linear-gradient(135deg,${PINK},#5b21b6)`,
                    color:loading||cart.length===0?T3:"#fff",
                    fontWeight:800, fontSize:15, cursor:"pointer",
                    boxShadow:loading||cart.length===0
                      ?"none":`0 6px 20px ${PINK}55`,
                  }}>
                  {loading?"Placing...":`Place Order · ₹${total}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADD ITEMS TO EXISTING ORDER — Modal Component
// ═══════════════════════════════════════════════════════════════════════════════

const AddItemsToOrderModal = ({ order, onClose, onItemsAdded }) => {
  const [mi,          setMi]          = useState([]);
  const [selCat,      setSelCat]      = useState("All");
  const [search,      setSearch]      = useState("");
  const [cart,        setCart]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [scpi,        setScpi]        = useState(0);
  const [gstRate,     setGstRate]     = useState(0);
  const [paymentMethod,setPaymentMethod] = useState(order.paymentMethod||"Cash");
  const [paymentStatus,setPaymentStatus] = useState(order.paymentStatus||"PENDING_VERIFICATION");
  const [vegFilter,   setVegFilter]   = useState("All");
  const [tempFilter,  setTempFilter]  = useState("All");
  const [catImages, setCatImages] = useState({});

  useEffect(()=>{
    getMenu({}).then(r=>{ setMi(r.data||[]); setMenuLoading(false); }).catch(()=>setMenuLoading(false));
    getRestaurantProfile().then(r=>{ const p=r.data?.data||r.data; setScpi(p?.serviceCharge||0); setGstRate(p?.gstRate||0); }).catch(()=>{});
    getCategories().then(r=>{
      const list = r.data?.data || r.data || [];
      const map = {};
      list.forEach(c=>{ if(c.name && c.image) map[c.name] = c.image; });
      setCatImages(map);
    }).catch(()=>{});
  },[]);

  const COLD_CATS = ["Mocktail","Cold Coffee","Shake","Juice","Lassi","Cold Drinks"];
  const HOT_CATS  = ["Tea","Coffee","Hot Drinks","Soup"];
  const BEV_CATS  = [...COLD_CATS,...HOT_CATS,"Drinks","Beverages"];
  const isBeverageCat = BEV_CATS.includes(selCat);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(mi.map(m=>m.category).filter(Boolean)));
    const sorted = [...unique].sort((a,b) => getCategoryRank(a) - getCategoryRank(b));
    return ["All", ...sorted];
  }, [mi]);

  const filtered = mi.filter(m=>{
    const matchCat    = selCat==="All" || m.category===selCat;
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchVeg    = vegFilter==="All" || m.tag===vegFilter;
    const matchTemp   = tempFilter==="All"
      || (tempFilter==="Cold" && COLD_CATS.includes(m.category))
      || (tempFilter==="Hot"  && HOT_CATS.includes(m.category));
    return matchCat && matchSearch && matchVeg && matchTemp;
  });

  const getQty    = (id) => cart.find(c=>c.item._id===id)?.qty||0;
  const addItem   = (item) => setCart(p=>{ const ex=p.find(c=>c.item._id===item._id); return ex?p.map(c=>c.item._id===item._id?{...c,qty:c.qty+1}:c):[...p,{item,qty:1}]; });
  const removeItem= (id)  => setCart(p=>{ const ex=p.find(c=>c.item._id===id); if(!ex)return p; return ex.qty===1?p.filter(c=>c.item._id!==id):p.map(c=>c.item._id===id?{...c,qty:c.qty-1}:c); });
  const clearCart = () => setCart([]);

  const totalQty = cart.reduce((s,c)=>s+c.qty,0);
  const subtotal = cart.reduce((s,c)=>s+c.item.price*c.qty,0);
  const tax      = Math.round(subtotal*(gstRate/100));
  const scAmt    = scpi*totalQty;
  const total    = subtotal+tax+scAmt;
  const isPaid   = order.paymentStatus==="PAID";

  const CAT_ICONS = {
    All:"🍽️",Biryani:"🍛",Burger:"🍔",Pizza:"🍕",Shake:"🥤",
    Mocktail:"🍹",Coffee:"☕",Tea:"🍵",Dessert:"🍨",Snacks:"🍟",
    Drinks:"🧃",Juice:"🍊",Lassi:"🥛",Noodles:"🍜",Rice:"🍚",
  };
  const getCatIcon = (cat) => catImages[cat] || CAT_ICONS[cat] || "🍽️";

  const handleSubmit = async () => {
    if(!cart.length) return toast.error("Add at least one item");
    try{
      setLoading(true);
      const token = localStorage.getItem("adminToken");
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/orders/${order._id}/add-items`,
        {
          method:"POST",
          headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
          body:JSON.stringify({
            items: cart.map(c=>({ menuItemId:c.item._id, qty:c.qty })),
            paymentMethod, paymentStatus,
          }),
        }
      );
      const data = await response.json();
      if(!response.ok) throw new Error(data.message||"Failed");
      toast.success(`✓ Added ${totalQty} items to order`);
      onItemsAdded(data);
      onClose();
    }catch(e){ toast.error(e.message||"Failed"); }
    finally{ setLoading(false); }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:999,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:12, backdropFilter:"blur(6px)", fontFamily:"'DM Sans',sans-serif" }}>

      <div style={{ background:"#0f0e1a", borderRadius:20, width:"100%", maxWidth:1300,
        height:"92vh", display:"flex", flexDirection:"column",
        border:`1px solid rgba(139,92,246,0.25)`,
        boxShadow:"0 30px 80px rgba(0,0,0,0.8)", overflow:"hidden" }}>

        {/* ── TOP BAR ── */}
        <div style={{ display:"flex", alignItems:"center", gap:12,
          padding:"14px 20px", borderBottom:`1px solid ${BDR}`,
          background:"#13111f", flexShrink:0 }}>

          <div style={{ display:"flex", flexDirection:"column" }}>
            <span style={{ fontWeight:700, fontSize:15, color:T1 }}>
              Add Items to Order
            </span>
            <span style={{ fontSize:12, color:T2, marginTop:2 }}>
              {order.orderId} · {order.guestName||order.user?.name||"Guest"}
              {order.tableNo ? ` · T${order.tableNo}` : ""}
              · <span style={{ color:isPaid?"#34d399":"#fbbf24", fontWeight:600 }}>
                  {isPaid?"✓ PAID":"⏳ DUE"} ₹{Math.round(order.total)}
                </span>
            </span>
          </div>

          <div style={{ flex:1 }}/>

          <div style={{ display:"flex", alignItems:"center", gap:8,
            background:CARD2, border:`1px solid ${BDR}`, borderRadius:10,
            padding:"7px 14px", minWidth:200 }}>
            <span style={{ fontSize:16 }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search items…"
              style={{ flex:1, background:"transparent", border:"none",
                outline:"none", fontSize:13, color:T1 }}/>
            {search && <button onClick={()=>setSearch("")}
              style={{ background:"none", border:"none", color:T3,
                cursor:"pointer", fontSize:14 }}>✕</button>}
          </div>

          <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
            borderRadius:8, border:`1px solid ${BDR}` }}>
            {["Cash","Online"].map(m=>(
              <button key={m} onClick={()=>setPaymentMethod(m)} style={{
                padding:"6px 10px", borderRadius:6, cursor:"pointer",
                fontWeight:600, fontSize:12, border:"none",
                background:paymentMethod===m?PINK:"transparent",
                color:paymentMethod===m?"#fff":T2,
              }}>{m==="Cash"?"💵":"📱"} {m}</button>
            ))}
          </div>

          <div style={{ display:"flex", gap:4, background:CARD2, padding:3,
            borderRadius:8, border:`1px solid ${BDR}` }}>
            {PAYMENT_STATUS_OPTIONS.map(({value,label,icon})=>{
              const st = PAY_STYLE[value] || DEFAULT_STATUS_STYLE;
              const active = paymentStatus===value;
              return (
                <button key={value} onClick={()=>setPaymentStatus(value)} style={{
                  padding:"6px 10px", borderRadius:6, cursor:"pointer",
                  fontWeight:600, fontSize:12, border:"none",
                  background:active?st.bg:"transparent",
                  color:active?st.color:T2,
                }}>{icon} {label}</button>
              );
            })}
          </div>

          <button className="op-btn" onClick={onClose} style={{ width:34, height:34, borderRadius:"50%",
            border:`1px solid ${BDR}`, background:CARD, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:T2, fontSize:16, flexShrink:0 }}>✕</button>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* ── LEFT: Category tabs ── */}
          <div className="op-scroll" style={{ width:150, background:"#0a0913",
            borderRight:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column",
            overflowY:"auto", flexShrink:0 }}>
            {categories.map(cat=>{
              const active = selCat===cat;
              const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
              return (
                <button key={cat} onClick={()=>setSelCat(cat)} style={{
                  padding:"14px 8px", border:"none", cursor:"pointer",
                  background:active?`${PINK}18`:"transparent",
                  borderLeft:active?`3px solid ${PINK}`:"3px solid transparent",
                  display:"flex", flexDirection:"column",
                  alignItems:"center", gap:4, transition:"all .15s",
                }}>
                {(() => {
                  const icon = getCatIcon(cat);
                  return icon?.startsWith?.("http")
                    ? <img src={icon} alt={cat}
                        onError={e=>e.target.style.display="none"}
                        style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/>
                    : <span style={{ fontSize:22 }}>{icon}</span>;
                })()}
                  <span style={{ fontSize:10, fontWeight:active?700:500,
                    color:active?PINK:T2, textAlign:"center",
                    lineHeight:1.2, wordBreak:"break-word" }}>
                    {cat}
                  </span>
                  <span style={{ fontSize:9, color:T3 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* ── MIDDLE: Menu grid ── */}
          <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:16 }}>

            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
              <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
                borderRadius:20, border:`1px solid ${BDR}` }}>
                {[["All","🍽️ All"],["Veg","🟢 Veg"],["Non Veg","🔴 Non Veg"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setVegFilter(v)} style={{
                    padding:"5px 12px", borderRadius:16, border:"none",
                    cursor:"pointer", fontSize:12, fontWeight:600,
                    background:vegFilter===v
                      ? (v==="Veg"?"rgba(22,163,74,0.3)"
                        : v==="Non Veg"?"rgba(239,68,68,0.3)"
                        : PINK)
                      : "transparent",
                    color:vegFilter===v
                      ? (v==="Veg"?"#4ade80"
                        : v==="Non Veg"?"#f87171"
                        : "#fff")
                      : T2,
                  }}>{label}</button>
                ))}
              </div>

              {(isBeverageCat || selCat==="All") && (
                <div style={{ display:"flex", gap:3, background:CARD2, padding:3,
                  borderRadius:20, border:`1px solid ${BDR}` }}>
                  {[["All","All"],["Hot","🔥 Hot"],["Cold","🧊 Cold"]].map(([v,label])=>(
                    <button key={v} onClick={()=>setTempFilter(v)} style={{
                      padding:"5px 12px", borderRadius:16, border:"none",
                      cursor:"pointer", fontSize:12, fontWeight:600,
                      background:tempFilter===v
                        ? (v==="Hot"?"rgba(234,88,12,0.3)"
                          : v==="Cold"?"rgba(59,130,246,0.3)"
                          : PINK)
                        : "transparent",
                      color:tempFilter===v
                        ? (v==="Hot"?"#fb923c"
                          : v==="Cold"?"#60a5fa"
                          : "#fff")
                        : T2,
                    }}>{label}</button>
                  ))}
                </div>
              )}
              <span style={{ fontSize:12, color:T3 }}>{filtered.length} items</span>
            </div>

            {menuLoading ? (
              <div style={{ textAlign:"center", padding:60, color:T3 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>Loading menu…
              </div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:60, color:T3 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📭</div>No items found
              </div>
            ) : (
              <div style={{ display:"grid",
                gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
                {filtered.map(m=>{
                  const qty = getQty(m._id);
                  const inCart = qty>0;
                  return (
                    <div key={m._id} className="op-menu-card" style={{
                      background:inCart?`${PINK}12`:CARD2,
                      border:`2px solid ${inCart?PINK:BDR}`,
                      borderRadius:RADIUS, overflow:"hidden",
                      display:"flex", flexDirection:"column",
                      position:"relative",
                    }}>
                      <div style={{ height:100, background:"#1a1625",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        overflow:"hidden", flexShrink:0 }}>
                        {m.image?.startsWith("http")
                          ? <img src={m.image} alt={m.name} onError={e=>e.target.style.display="none"}
                              style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                          : <span style={{ fontSize:42 }}>🍽️</span>}
                      </div>
                      {inCart && (
                        <div style={{ position:"absolute", top:8, right:8,
                          background:PINK, color:"#fff", borderRadius:"50%",
                          width:24, height:24, display:"flex", alignItems:"center",
                          justifyContent:"center", fontSize:12, fontWeight:700 }}>{qty}</div>
                      )}
                      <div style={{ padding:"10px 10px 6px", flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:T1,
                          lineHeight:1.3, marginBottom:3 }}>{m.name}</div>
                        <div style={{ fontSize:11, color:T3 }}>{m.category}</div>
                        <div style={{ fontWeight:700, fontSize:15, color:PINK, marginTop:4 }}>₹{m.price}</div>
                      </div>
                      <div style={{ padding:"0 8px 10px", display:"flex", alignItems:"center", gap:6 }}>
                        {qty===0 ? (
                          <button className="op-btn" onClick={()=>addItem(m)} style={{
                            flex:1, padding:"8px 0", borderRadius:10,
                            background:`linear-gradient(135deg,${PINK},#5b21b6)`,
                            color:"#fff", border:"none", cursor:"pointer",
                            fontWeight:700, fontSize:13,
                          }}>+ Add</button>
                        ) : (
                          <>
                            <button onClick={()=>removeItem(m._id)} style={{
                              width:32, height:32, borderRadius:"50%",
                              border:`2px solid ${PINK}`, background:"transparent",
                              color:PINK, cursor:"pointer", fontWeight:700,
                              fontSize:18, display:"flex", alignItems:"center",
                              justifyContent:"center" }}>−</button>
                            <span style={{ flex:1, textAlign:"center",
                              fontWeight:700, fontSize:16, color:T1 }}>{qty}</span>
                            <button onClick={()=>addItem(m)} style={{
                              width:32, height:32, borderRadius:"50%",
                              background:PINK, color:"#fff", border:"none",
                              cursor:"pointer", fontWeight:700, fontSize:18,
                              display:"flex", alignItems:"center",
                              justifyContent:"center" }}>+</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT: Cart ── */}
          <div style={{ width:280, background:"#13111f",
            borderLeft:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column", flexShrink:0 }}>

            <div style={{ padding:"14px 14px 10px",
              borderBottom:`1px solid ${BDR}`, flexShrink:0 }}>
              <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                textTransform:"uppercase", marginBottom:8 }}>Current Order</div>
              <div style={{ background:CARD2, borderRadius:8, padding:10,
                border:`1px solid ${isPaid?"rgba(16,185,129,0.3)":"rgba(245,158,11,0.3)"}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}>
                  <span style={{ color:T3 }}>Items</span>
                  <span style={{ color:T1, fontWeight:500 }}>{order.items?.length||0}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13,
                  fontWeight:700, marginTop:4 }}>
                  <span style={{ color:T1 }}>Total</span>
                  <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
                </div>
                <div style={{ marginTop:6, display:"flex", gap:6 }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px",
                    borderRadius:20,
                    background:isPaid?"rgba(16,185,129,0.15)":"rgba(245,158,11,0.15)",
                    color:isPaid?"#34d399":"#fbbf24" }}>
                    {isPaid?"✓ PAID":"⏳ DUE"}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ padding:"10px 14px 6px", flexShrink:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:700, color:T1 }}>
                  New Items
                  {totalQty>0 && <span style={{ marginLeft:8, background:PINK,
                    color:"#fff", borderRadius:"50%", width:20, height:20,
                    display:"inline-flex", alignItems:"center",
                    justifyContent:"center", fontSize:11, fontWeight:700,
                  }}>{totalQty}</span>}
                </span>
                {cart.length>0 && (
                  <button onClick={clearCart} style={{ background:"none",
                    border:"none", color:"#f87171", cursor:"pointer",
                    fontSize:12, fontWeight:600 }}>Clear</button>
                )}
              </div>
            </div>

            <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:"4px 14px" }}>
              {cart.length===0 ? (
                <div style={{ textAlign:"center", padding:"30px 0", color:T3 }}>
                  <div style={{ fontSize:32, marginBottom:6 }}>➕</div>
                  <div style={{ fontSize:12 }}>Select items to add</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {cart.map(c=>(
                    <div key={c.item._id} style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"8px 10px", borderRadius:10,
                      background:CARD, border:`1px solid ${BDR}`,
                    }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:T1,
                          overflow:"hidden", textOverflow:"ellipsis",
                          whiteSpace:"nowrap" }}>{c.item.name}</div>
                        <div style={{ fontSize:11, color:T3 }}>₹{c.item.price} × {c.qty}</div>
                      </div>
                      <div style={{ fontWeight:700, color:PINK, fontSize:13, minWidth:44, textAlign:"right" }}>
                        ₹{c.item.price*c.qty}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <button onClick={()=>removeItem(c.item._id)} style={{
                          width:24, height:24, borderRadius:"50%",
                          border:`1.5px solid ${BDR}`, background:CARD2,
                          color:T2, cursor:"pointer", fontWeight:700, fontSize:14,
                          display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                        <button onClick={()=>addItem(c.item)} style={{
                          width:24, height:24, borderRadius:"50%",
                          background:PINK, color:"#fff", border:"none",
                          cursor:"pointer", fontWeight:700, fontSize:14,
                          display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {cart.length>0 && (
              <div style={{ padding:"12px 14px 16px",
                borderTop:`1px solid ${BDR}`, flexShrink:0 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2 }}>
                    <span>New subtotal</span><span>₹{subtotal}</span>
                  </div>
                  {tax>0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T2 }}>
                    <span>GST ({gstRate}%)</span><span>₹{tax}</span>
                  </div>}
                  <div style={{ display:"flex", justifyContent:"space-between",
                    fontWeight:700, fontSize:14, paddingTop:6,
                    borderTop:`1px solid ${BDR}`, marginTop:2 }}>
                    <span style={{ color:T1 }}>New Total</span>
                    <span style={{ color:PINK }}>₹{total}</span>
                  </div>
                  <div style={{ fontSize:11, color:T3, textAlign:"center", marginTop:4 }}>
                    Order total: ₹{Math.round(order.total)} → ₹{Math.round(Number(order.total||0)+total)}
                  </div>
                </div>

                <button className="op-btn" onClick={handleSubmit} disabled={loading||cart.length===0} style={{
                  width:"100%", padding:"13px 0", borderRadius:14, border:"none",
                  background:loading?"#374151":`linear-gradient(135deg,${PINK},#5b21b6)`,
                  color:loading?T3:"#fff", fontWeight:800, fontSize:14,
                  cursor:loading?"not-allowed":"pointer",
                  boxShadow:loading?"none":`0 6px 20px ${PINK}55`,
                }}>
                  {loading?`Adding…`:`Add Items · ₹${total}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-ORDER TABLE VIEW
// ══════════════════════════════════════════════════════════════════════════════

const MultiOrderTableView = ({ orders, tableNo, onStatusChange, onPaymentChange, onCombinedBill, onAddItems }) => {
  const [expandedOrder, setExpandedOrder] = useState(null);

  if (orders.length === 0) {
    return (
      <div style={{ marginTop:14, textAlign:"center", padding:20, color:T3,
        fontSize:12, border:`1px dashed ${BDR}`, borderRadius:RADIUS }}>
        Table {tableNo} is free
      </div>
    );
  }

  const grandTotal  = orders.reduce((s,o) => s + Number(o.total||0), 0);
  const paidOrders  = orders.filter(o=>o.paymentStatus==="PAID");
  const unpaidOrders= orders.filter(o=>o.paymentStatus!=="PAID");
  const paidTotal   = paidOrders.reduce((s,o) => s + Number(o.total||0), 0);
  const dueTotal    = grandTotal - paidTotal;

  return (
    <div style={{ marginTop:14 }}>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:11, fontWeight:600, color:T2, letterSpacing:1, textTransform:"uppercase" }}>
          Table {tableNo} · {orders.length} order{orders.length!==1?"s":""}
        </span>
        <span style={{ fontSize:10, color:T3 }}>
          {paidOrders.length} paid · {unpaidOrders.length} pending
        </span>
      </div>

      {unpaidOrders.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#f87171", letterSpacing:1,
            textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#f87171" }}/>
            Pending Payment ({unpaidOrders.length})
          </div>
          {unpaidOrders.map((order, idx) => (
            <OrderCard
              key={order._id}
              order={order}
              idx={idx}
              isExpanded={expandedOrder===order._id}
              onExpand={()=>setExpandedOrder(expandedOrder===order._id?null:order._id)}
              onStatusChange={onStatusChange}
              onPaymentChange={onPaymentChange}
              onCombinedBill={onCombinedBill}
              onAddItems={onAddItems}
            />
          ))}
        </div>
      )}

      {paidOrders.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#34d399", letterSpacing:1,
            textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#34d399" }}/>
            Paid ({paidOrders.length})
          </div>
          {paidOrders.map((order, idx) => (
            <OrderCard
              key={order._id}
              order={order}
              idx={idx}
              isExpanded={expandedOrder===order._id}
              onExpand={()=>setExpandedOrder(expandedOrder===order._id?null:order._id)}
              onStatusChange={onStatusChange}
              onPaymentChange={onPaymentChange}
              onCombinedBill={onCombinedBill}
              onAddItems={onAddItems}
            />
          ))}
        </div>
      )}

      <div style={{ padding:14, background:`${PINK}08`, borderRadius:RADIUS,
        border:`1px solid ${PINK}33`, marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:600, color:T2, textTransform:"uppercase",
          letterSpacing:1, marginBottom:10 }}>Table Bill Summary</div>

        {orders.map((o,i) => {
          const paid = o.paymentStatus==="PAID";
          return (
            <div key={o._id} style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center", padding:"5px 0",
              borderBottom:`1px solid rgba(255,255,255,0.05)`, fontSize:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%",
                  background:paid?"#34d399":"#f87171", flexShrink:0 }}/>
                <span style={{ color:T2 }}>
                  {o.user?.name||o.guestName||`Order ${i+1}`}
                </span>
                <span style={{ fontSize:10, color:T3 }}>({o.items?.length||0} items)</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:11,
                  color:paid?"#34d399":"#fbbf24",
                  fontWeight:600 }}>
                  {paid?"✓ Paid":"⏳ Due"}
                </span>
                <span style={{ fontWeight:700, color:T1 }}>₹{Math.round(o.total)}</span>
              </div>
            </div>
          );
        })}

        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${BDR}` }}>
          {paidTotal > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#34d399", marginBottom:4 }}>
              <span>✓ Paid</span><span>₹{Math.round(paidTotal)}</span>
            </div>
          )}
          {dueTotal > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13,
              fontWeight:700, color:"#f87171", marginBottom:4 }}>
              <span>⏳ Due</span><span>₹{Math.round(dueTotal)}</span>
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"space-between",
            fontSize:15, fontWeight:700, marginTop:6, paddingTop:6, borderTop:`1px solid ${BDR}` }}>
            <span style={{ color:T1 }}>Grand Total</span>
            <span style={{ color:PINK }}>₹{Math.round(grandTotal)}</span>
          </div>
        </div>
      </div>

      {onCombinedBill && (
        <button className="op-btn" onClick={()=>onCombinedBill("table", tableNo)}
          style={{ width:"100%", marginTop:10, padding:"10px", borderRadius:10,
            border:`1px solid ${PINK}44`, background:`${PINK}10`,
            color:PINK, cursor:"pointer", fontSize:13, fontWeight:600 }}>
          🧾 Generate Combined Bill for Table {tableNo}
        </button>
      )}
    </div>
  );
};

// ── OrderCard — individual order row inside table view ─────────────────────────
const OrderCard = ({ order, idx, isExpanded, onExpand, onStatusChange, onPaymentChange, onCombinedBill, onAddItems }) => {
  const displayName  = order.user?.name || order.guestName || `Order ${idx+1}`;
  const displayPhone = order.guestPhone||order.user?.phone ||  null;
  const av           = avc(displayName);
  const isPaid       = order.paymentStatus === "PAID";
  const canAddItems  = ["CONFIRMED","PREPARING","READY"].includes(order.status);

  const borderColor = isPaid ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)";
  const bgColor     = isPaid ? "rgba(16,185,129,0.04)" : "rgba(245,158,11,0.04)";

  return (
    <div style={{ marginBottom:6, borderRadius:RADIUS, overflow:"hidden",
      border:`1px solid ${isExpanded ? PINK+"55" : borderColor}`,
      background: isExpanded ? `${PINK}05` : bgColor }}>

      <div onClick={onExpand} className="op-row" style={{ padding:"11px 13px", display:"flex",
        alignItems:"center", gap:10, cursor:"pointer" }}>

        <div style={{ width:30, height:30, borderRadius:"50%", background:av.bg, color:av.c,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, fontWeight:600, flexShrink:0 }}>
          {ini(displayName)}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:T1 }}>{displayName}</div>
          <div style={{ fontSize:11, color:T3, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {order.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")||"—"}
          </div>
        </div>

        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:PINK }}>₹{Math.round(order.total)}</div>
          <div style={{ display:"flex", gap:4, justifyContent:"flex-end", marginTop:3 }}>
            <Badge label={order.paymentStatus} map={PAY_STYLE} format={formatPayment}/>
            <Badge label={order.status} map={STATUS_STYLE} format={formatStatus}/>
          </div>
        </div>

        <span style={{ fontSize:12, color:T3 }}>{isExpanded?"▲":"▼"}</span>
      </div>

      {isExpanded && (
        <div style={{ padding:"0 13px 13px", borderTop:`1px solid ${BDR}` }}>

          <div style={{ marginTop:10, marginBottom:10 }}>
            {order.items?.map((item,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between",
                padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)`, fontSize:12 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ width:20, height:20, borderRadius:5, background:`${PINK}20`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:10, fontWeight:600, color:PINK }}>{item.qty}</div>
                  <span style={{ color:T1 }}>{item.name}</span>
                </div>
                <span style={{ color:T1, fontWeight:500 }}>₹{item.price*item.qty}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between",
              fontWeight:700, fontSize:14, marginTop:8, color:T1 }}>
              <span>Total</span>
              <span style={{ color:PINK }}>₹{Math.round(order.total)}</span>
            </div>
          </div>

          <div style={{ fontSize:11, color:T3, marginBottom:10 }}>
            {order.orderId} · {displayPhone ? `+91 ${displayPhone}` : "No phone"} · {order.paymentMethod||"Cash"}
          </div>

          {/* Order Status buttons */}
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
              textTransform:"uppercase", marginBottom:6 }}>Order Status</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {STATUSES.filter(s=>s!=="All").filter(s=>s!==order.status).map(s => {
                  const st = STATUS_STYLE[s] || DEFAULT_STATUS_STYLE;
                  return (
                    <button key={s} className="op-chip" onClick={()=>{ onStatusChange(order._id,s); }}
                      style={{ padding:"4px 10px", borderRadius:20, border:`1px solid ${st.color}44`,
                        background:st.bg, color:st.color, cursor:"pointer", fontSize:11, fontWeight:500 }}>
                      {formatStatus(s)}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Payment Status buttons */}
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
              textTransform:"uppercase", marginBottom:6 }}>Payment Status</div>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {["PENDING_VERIFICATION","PAID","FAILED"].map(s => {
                const st = PAY_STYLE[s] || DEFAULT_STATUS_STYLE;
                const active = order.paymentStatus===s;
                return (
                  <button key={s} className="op-chip" onClick={()=>!active&&onPaymentChange(order._id,{ paymentStatus:s })}
                    style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600,
                      cursor:active?"default":"pointer",
                      border:`1px solid ${active?st.color+"88":st.color+"44"}`,
                      background:active?st.bg:"transparent",
                      color:st.color, opacity:active?1:0.65 }}>
                    {active?"✓ ":""}{formatPayment(s)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment Method buttons */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:1,
              textTransform:"uppercase", marginBottom:6 }}>Payment Method</div>
            <div style={{ display:"flex", gap:5 }}>
              {["Cash","Online"].map(m => {
                const active = (order.paymentMethod||"Cash")===m;
                return (
                  <button key={m} className="op-chip" onClick={()=>!active&&onPaymentChange(order._id,{ paymentMethod:m })}
                    style={{ padding:"5px 14px", borderRadius:20, fontSize:11, fontWeight:600,
                      cursor:active?"default":"pointer",
                      border:`2px solid ${active?PINK:BDR}`,
                      background:active?`${PINK}15`:CARD2,
                      color:active?PINK:T2 }}>
                    {m==="Cash"?"💵":"📱"} {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {canAddItems && onAddItems && (
              <button className="op-btn" onClick={()=>onAddItems(order)}
                style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
                  border:`1px solid ${PINK}44`, background:`${PINK}10`, color:PINK, cursor:"pointer" }}>
                + Add items
              </button>
            )}
            {displayPhone && onCombinedBill && (
              <button className="op-btn" onClick={()=>onCombinedBill("phone", displayPhone)}
                style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
                  border:"1px solid rgba(139,92,246,0.4)", background:"rgba(139,92,246,0.1)",
                  color:"#c4b5fd", cursor:"pointer" }}>
                🧾 Customer Bill
              </button>
            )}
            <button className="op-btn" onClick={async()=>{
              try{
                await printOrderBill(order._id);
                toast.success("Bill sent to printer ✓");
              }catch{ toast.error("Printer not running"); }
            }} style={{ padding:"5px 12px", borderRadius:8, fontSize:12, cursor:"pointer",
              border:"1px solid rgba(16,185,129,0.4)", background:"rgba(16,185,129,0.1)",
              color:"#34d399", whiteSpace:"nowrap" }}>
              🖨️ Bill
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ORDERS PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function OrdersPage() {
  const [orders,setOrders]=useState([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("All");
  const [typeF,setTypeF]=useState("All");
  const [payF,setPayF]=useState("All");
  const [expanded,setExpanded]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [showAddItems, setShowAddItems] = useState(null);
  const [page,setPage]=useState(1);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [viewMode,setViewMode]=useState("recent");
  const [tables,setTables]=useState([]);
  const [tablesLoading,setTablesLoading]=useState(true);
  const [tableSelected,setTableSelected]=useState(null);
  const [showCombinedBill, setShowCombinedBill] = useState(null);
  const [showTables, setShowTables] = useState(true);
  const PER_PAGE=15;

  const fetchTables=useCallback(()=>{ getAllTables().then(r=>{setTables(r.data?.tables||[]);setTablesLoading(false);}).catch(()=>setTablesLoading(false)); },[]);
  useEffect(()=>{ fetchTables(); },[fetchTables]);

  const fetchOrders=useCallback(()=>{
    getAllOrders({ limit:10000 }).then(r=>{ setOrders(r.data?.orders||[]); setLoading(false); })
      .catch(()=>{ toast.error("Failed to load orders"); setLoading(false); });
  },[]);
  useEffect(()=>{ fetchOrders(); },[fetchOrders]);

  useEffect(()=>{
    const handleKeyDown=(e)=>{
      if(showCreate) return;
      const tag=document.activeElement?.tagName;
      const isTyping=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||document.activeElement?.isContentEditable;
      if(isTyping) return;
      if(e.key.toLowerCase()==="n"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){ e.preventDefault(); setShowCreate(true); }
    };
    window.addEventListener("keydown",handleKeyDown);
    return()=>window.removeEventListener("keydown",handleKeyDown);
  },[showCreate]);

  const filtered=orders.filter(o=>{
    const q=search.toLowerCase();
    const d=new Date(o.createdAt).toISOString().slice(0,10);
    return (filter==="All"||o.status===filter)&&(typeF==="All"||o.orderType===typeF)&&
           (payF==="All"||o.paymentStatus===payF)&&(!startDate||d>=startDate)&&(!endDate||d<=endDate)&&
           (!q||o.orderId?.toLowerCase().includes(q)||o.guestName?.toLowerCase().includes(q)||
            o.guestPhone?.includes(q)||o.user?.phone?.includes(q));
  });

  const recentFiltered=orders.filter(o=>{
    const q=search.toLowerCase();
    return new Date(o.createdAt).toDateString()===new Date().toDateString()&&
           ACTIVE_ORDER_STATUSES.includes(o.status)&&
           (!q||o.orderId?.toLowerCase().includes(q)||o.guestName?.toLowerCase().includes(q)||
            o.guestPhone?.includes(q)||o.user?.phone?.includes(q));
  });

  const displayedOrders=viewMode==="recent"?recentFiltered:filtered;
  const ordersInRange=orders.filter(o=>{ const d=new Date(o.createdAt).toISOString().slice(0,10); return (!startDate||d>=startDate)&&(!endDate||d<=endDate); });
  const rangeStats={ count:filtered.filter(o=>o.status==="COMPLETED"&&o.paymentStatus==="PAID").length, amount:ordersInRange.filter(o=>o.status==="COMPLETED"&&o.paymentStatus==="PAID").reduce((s,o)=>s+Number(o.total||0),0) };

  const handleStatusChange=async(id,newStatus)=>{
    try{ await updateOrderStatus(id,newStatus); setOrders(prev=>prev.map(o=>o._id===id?{...o,status:newStatus}:o)); toast.success(`→ ${formatStatus(newStatus)}`); }
    catch{ toast.error("Update failed"); }
  };

  const handlePaymentChange=async(id,data)=>{
    try{
      await fetch(`${import.meta.env.VITE_API_URL}/admin/orders/${id}/payment`,{
        method:"PATCH",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${localStorage.getItem("adminToken")}` },
        body:JSON.stringify(data),
      });
      setOrders(prev=>prev.map(o=>o._id===id?{...o,...data}:o));
      toast.success("Payment updated ✓");
    }catch{ toast.error("Payment update failed"); }
  };

  const tableOrderMap = {};
  orders
    .filter(o => o.orderType === "DINE_IN" && o.tableNo && ACTIVE_ORDER_STATUSES.includes(o.status))
    .forEach(o => {
      const tNum = Number(o.tableNo);
      if (!tableOrderMap[tNum]) tableOrderMap[tNum] = [];
      tableOrderMap[tNum].push(o);
    });

  const selectedTableOrders = tableSelected ? tableOrderMap[tableSelected] || [] : [];

  const paginated=displayedOrders.slice((page-1)*PER_PAGE,page*PER_PAGE);
  const totalPages=Math.ceil(displayedOrders.length/PER_PAGE);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today);

  const stats = {
    total:        todayOrders.length,
    revenue:      todayOrders.filter(o => o.paymentStatus === "PAID")
                    .reduce((s,o) => s + Number(o.total||0), 0),
    active:       todayOrders.filter(o => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
    paid:         todayOrders.filter(o => o.paymentStatus === "PAID").length,
    paidAmount:   todayOrders.filter(o => o.paymentStatus === "PAID")
                    .reduce((s,o) => s + Number(o.total||0), 0),
    unpaid:       todayOrders.filter(o => o.paymentStatus === "PENDING_VERIFICATION").length,
    unpaidAmount: todayOrders.filter(o => o.paymentStatus === "PENDING_VERIFICATION")
                    .reduce((s,o) => s + Number(o.total||0), 0),
    cash:         todayOrders.filter(o => o.paymentMethod === "Cash" && o.paymentStatus === "PAID").length,
    cashAmount:   todayOrders.filter(o => o.paymentMethod === "Cash" && o.paymentStatus === "PAID")
                    .reduce((s,o) => s + Number(o.total||0), 0),
    online:       todayOrders.filter(o => o.paymentMethod === "Online" && o.paymentStatus === "PAID").length,
    onlineAmount: todayOrders.filter(o => o.paymentMethod === "Online" && o.paymentStatus === "PAID")
                    .reduce((s,o) => s + Number(o.total||0), 0),
  };

  const clearFilters=()=>{ setSearch(""); setFilter("All"); setTypeF("All"); setPayF("All"); setStartDate(""); setEndDate(""); setPage(1); };
  const hasFilters=search||filter!=="All"||typeF!=="All"||payF!=="All"||startDate||endDate;

  return (
    <div style={{ padding:28, fontFamily:"'DM Sans',sans-serif" }}>
      <GlobalOrdersStyle/>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:12 }}>

        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div>
            <h1 style={{ fontSize:23, fontWeight:700, color:T1, margin:0, letterSpacing:-0.4 }}>
              {viewMode==="recent"?"Recent Orders":"All Orders"}
            </h1>
            <div style={{ fontSize:13, color:T2, marginTop:4 }}>
              {viewMode==="recent"?"Today's active orders":"Search, filter and manage every order"}
            </div>
          </div>

          <button className="op-btn" onClick={()=>setShowTables(t=>!t)} style={{
            padding:"6px 14px", borderRadius:20, fontWeight:600, fontSize:12,
            cursor:"pointer", border:`1px solid ${showTables?PINK:BDR}`,
            background:showTables?`${PINK}15`:CARD2,
            color:showTables?PINK:T2,
            display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap",
            alignSelf:"flex-start", marginTop:2,
          }}>
            🪑 {showTables ? "Hide Tables" : "Show Tables"}
          </button>
        </div>

        <button className="op-btn" onClick={()=>setShowCreate(true)} style={{ padding:"11px 22px", background:`linear-gradient(135deg,${PINK},#5b21b6)`, color:"#fff", border:"none", borderRadius:25, fontWeight:700, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", gap:8, boxShadow:`0 4px 14px ${PINK}44` }}>
          <span style={{ fontSize:18 }}>+</span> Create Order
          <span style={{ fontSize:10, fontWeight:700, background:"rgba(255,255,255,0.2)", padding:"2px 6px", borderRadius:5, fontFamily:"monospace" }}>N</span>
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:showTables?"minmax(0,7fr) minmax(280px,3fr)":"1fr", gap:16, alignItems:"start" }}>

        {/* ── LEFT — Orders ── */}
        <div style={{ minWidth:0 }}>

          {/* ── Today's Stats — Row 1 ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:10 }}>
            <StatPill icon="📦" label="Today's Orders"    value={stats.total}                              />
            <StatPill icon="💰" label="Today's Collected" value={`₹${fmt(stats.revenue)}`} color="#34d399"/>
            <StatPill icon="⏳" label="Active Orders"     value={stats.active}  color="#fbbf24"           />
            <StatPill icon="📅" label="Total Orders Ever" value={orders.length} color={PINK}              />
          </div>

          {/* ── Today's Stats — Row 2 ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
            <StatPill icon="✅" label="Today Paid"
              value={stats.paid}   color="#34d399" sub={`₹${fmt(stats.paidAmount)}`}/>
            <StatPill icon="🔴" label="Today Due"
              value={stats.unpaid} color="#f87171" sub={`₹${fmt(stats.unpaidAmount)}`}/>
            <StatPill icon="💵" label="Cash Collected"   value={stats.cash}   color="#fbbf24" sub={`₹${fmt(stats.cashAmount)}`}/>
            <StatPill icon="📱" label="Online Collected" value={stats.online} color="#c4b5fd" sub={`₹${fmt(stats.onlineAmount)}`}/>
          </div>

          {/* ── Filter bar ── */}
          <div className="op-card" style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:RADIUS, padding:16, marginBottom:16 }}>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
              <div style={{ display:"flex", gap:4, background:CARD2, padding:4, borderRadius:10, border:`1px solid ${BDR}`, flexShrink:0 }}>
                <button onClick={()=>{ setViewMode("recent"); setPage(1); }} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", whiteSpace:"nowrap", background:viewMode==="recent"?PINK:"transparent", color:viewMode==="recent"?"#fff":T2 }}>Recent · Today</button>
                <button onClick={()=>{ setViewMode("all"); setPage(1); }} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", whiteSpace:"nowrap", background:viewMode==="all"?PINK:"transparent", color:viewMode==="all"?"#fff":T2 }}>All Orders</button>
              </div>
              <input value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }} placeholder="Search order ID, customer, phone…" style={{ ...inp, flex:1, minWidth:220 }}/>
            </div>

            {viewMode==="all"&&(
              <>
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <input type="date" value={startDate} onChange={e=>{ setStartDate(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", color:startDate?T1:T3 }}/>
                    <span style={{ fontSize:12, color:T3 }}>to</span>
                    <input type="date" value={endDate} min={startDate||undefined} onChange={e=>{ setEndDate(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", color:endDate?T1:T3 }}/>
                    {(startDate||endDate)&&(
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", borderRadius:20, background:`${PINK}10`, border:`1px solid ${PINK}33`, fontSize:12, whiteSpace:"nowrap" }}>
                        <span style={{ color:T2 }}>📦 <b style={{ color:T1 }}>{rangeStats.count}</b></span>
                        <span style={{ color:T3 }}>|</span>
                        <span style={{ color:T2 }}>💰 <b style={{ color:PINK }}>₹{fmt(rangeStats.amount)}</b></span>
                      </div>
                    )}
                  </div>
                  <select value={filter} onChange={e=>{ setFilter(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", cursor:"pointer" }}>
                    {STATUSES.map(o=><option key={o} value={o} style={{ background:CARD }}>{o==="All"?"All Statuses":formatStatus(o)}</option>)}
                  </select>
                  <select value={typeF} onChange={e=>{ setTypeF(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", cursor:"pointer" }}>
                    {ORDER_TYPES.map(o=><option key={o} value={o} style={{ background:CARD }}>{o==="All"?"All Types":formatOrderType(o)}</option>)}
                  </select>
                  <select value={payF} onChange={e=>{ setPayF(e.target.value); setPage(1); }} style={{ ...inp, width:"auto", cursor:"pointer" }}>
                    {PAYMENT_STATUSES.map(o=><option key={o} value={o} style={{ background:CARD }}>{o==="All"?"All Payments":formatPayment(o)}</option>)}
                  </select>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {STATUSES.map(s=>{
                    const cnt=s==="All"?orders.length:orders.filter(o=>o.status===s).length;
                    const st=STATUS_STYLE[s]||DEFAULT_STATUS_STYLE;
                    const active=filter===s;
                    return <button key={s} className="op-chip" onClick={()=>{ setFilter(s); setPage(1); }} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:500, border:active?"none":`1px solid ${BDR}`, background:active?(s==="All"?PINK:st.bg):CARD2, color:active?(s==="All"?"#fff":st.color):T2 }}>{s==="All"?"All":formatStatus(s)} <span style={{ opacity:0.6 }}>({cnt})</span></button>;
                  })}
                  {hasFilters&&<button onClick={clearFilters} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, cursor:"pointer", border:`1px solid ${PINK}44`, color:PINK, background:CARD2, marginLeft:4 }}>Clear ✕</button>}
                </div>
              </>
            )}
          </div>

          {/* ── Orders table ── */}
          <div className="op-card" style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:RADIUS, padding:18 }}>
            {loading?(
              <div style={{ textAlign:"center", padding:48, color:T3 }}>Loading…</div>
            ):displayedOrders.length===0?(
              <div style={{ textAlign:"center", padding:48 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                <div style={{ fontSize:14, color:T2 }}>{viewMode==="recent"?"No active orders today yet":"No orders match your filters"}</div>
                {viewMode==="all"&&hasFilters&&<button onClick={clearFilters} style={{ marginTop:12, padding:"8px 20px", borderRadius:20, border:`1px solid ${PINK}`, color:PINK, background:"transparent", cursor:"pointer" }}>Clear filters</button>}
                {viewMode==="recent"&&<button onClick={()=>{ setViewMode("all"); setPage(1); }} style={{ marginTop:12, padding:"8px 20px", borderRadius:20, border:`1px solid ${PINK}`, color:PINK, background:"transparent", cursor:"pointer" }}>View all orders</button>}
              </div>
            ):(
              <>
                <div style={{ fontSize:12, color:T3, marginBottom:12 }}>
                  Showing <span style={{ fontWeight:600, color:PINK }}>{(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE,displayedOrders.length)}</span> of <span style={{ fontWeight:600, color:T1 }}>{displayedOrders.length}</span> {viewMode==="recent"?"active orders today":"orders"}
                </div>
                <div className="op-scroll" style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                      <tr>
                        {["Order","Customer","Items","Amount","Status","Payment","Date",""].map((h,i)=>(
                          <th key={i} style={{
                            textAlign:"left", padding:"9px 12px", fontSize:11,
                            color:T2, fontWeight:600, letterSpacing:0.5,
                            borderBottom:`1px solid ${BDR}`, whiteSpace:"nowrap",
                            ...(i===7 ? { width:150, minWidth:100 } : {})
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(o=>{
                        const isOpen = expanded===o._id;
                        const displayName = o.guestName || o.user?.name || "Guest";
                        const displayPhone = o.guestPhone || o.user?.phone || null;
                        const av = avc(displayName);
                        return (
                          <Fragment key={o._id}>
                            <tr className="op-row" style={{
                              borderBottom:isOpen?"none":`1px solid rgba(255,255,255,0.04)`,
                              background:isOpen?`${PINK}05`:"transparent",
                            }}>
                              {/* Order ID + Table */}
                              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                                <div style={{ fontWeight:600, color:PINK, fontSize:13 }}>{o.orderId}</div>
                                <div style={{ marginTop:3 }}>
                                  {o.tableNo
                                    ? <span style={{ background:`${PINK}18`, color:PINK, padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600 }}>T{o.tableNo}</span>
                                    : <span style={{ fontSize:11, color:T3 }}>{formatOrderType(o.orderType)}</span>}
                                </div>
                              </td>

                              {/* Customer */}
                              <td style={{ padding:"10px 12px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:28, height:28, borderRadius:"50%", background:av.bg, color:av.c, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, flexShrink:0 }}>{ini(displayName)}</div>
                                  <div>
                                    <div style={{ fontWeight:500, color:T1, fontSize:12 }}>{displayName}</div>
                                    {displayPhone && <div style={{ fontSize:11, color:T3 }}>+91 {displayPhone}</div>}
                                  </div>
                                </div>
                              </td>

                              {/* Items */}
                              <td style={{ padding:"10px 12px", maxWidth:160 }}>
                                <div style={{ fontSize:12, color:T2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                  {o.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")||"—"}
                                </div>
                              </td>

                              {/* Amount */}
                              <td style={{ padding:"10px 12px", fontWeight:700, color:T1, whiteSpace:"nowrap" }}>
                                ₹{Math.round(o.total)}
                              </td>

                              {/* Status */}
                              <td style={{ padding:"10px 12px" }}>
                                <Badge label={o.status} map={STATUS_STYLE} format={formatStatus}/>
                              </td>

                              {/* Payment */}
                              <td style={{ padding:"10px 12px" }}>
                                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                  <Badge label={o.paymentStatus} map={PAY_STYLE} format={formatPayment}/>
                                  {o.paymentStatus !== "PENDING_VERIFICATION" && (
                                    <span style={{ fontSize:10, color:T3 }}>{o.paymentMethod||"Cash"}</span>
                                  )}
                                </div>
                              </td>

                              {/* Date */}
                              <td style={{ padding:"10px 12px", fontSize:12, color:T3, whiteSpace:"nowrap" }}>
                                {new Date(o.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}
                                <div style={{ fontSize:11 }}>{new Date(o.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                              </td>

                              {/* Actions */}
                              <td style={{ padding:"8px 12px", width:95 }}>
                                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                  <button className="op-btn" onClick={()=>setExpanded(isOpen?null:o._id)} style={{
                                    padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
                                    cursor:"pointer", border:"none", width:"100%",
                                    background:isOpen?`${PINK}25`:CARD2,
                                    color:isOpen?PINK:T2,
                                  }}>
                                    {isOpen?"▲ Close":"▼ View"}
                                  </button>

                                  {["CONFIRMED","PREPARING","READY"].includes(o.status) && (
                                    <button className="op-btn" onClick={()=>setShowAddItems(o._id)} style={{
                                      padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
                                      cursor:"pointer", border:"none", width:"100%",
                                      background:`${PINK}20`, color:PINK,
                                    }}>
                                      ＋ Add
                                    </button>
                                  )}

                                  <button className="op-btn" onClick={async()=>{
                                    try{
                                      await printOrderBill(o._id);
                                      toast.success("Bill sent ✓");
                                    }catch(err){
                                      toast.error(err?.response?.data?.message||"Printer off");
                                    }
                                  }} style={{
                                    padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
                                    cursor:"pointer", border:"none", width:"100%",
                                    background:"rgba(16,185,129,0.2)", color:"#34d399",
                                  }}>
                                    🖨️ Bill
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {isOpen && (
                              <tr style={{ borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
                                <td colSpan={8} style={{ padding:"4px 12px 16px" }}>
                                  <OrderDetail order={o}
                                    onStatusChange={(id,s)=>{ handleStatusChange(id,s); setExpanded(null); }}
                                    onPaymentChange={handlePaymentChange}
                                    onCombinedBill={(mode,value)=>setShowCombinedBill({mode,value})}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages>1&&(
                  <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:16, flexWrap:"wrap" }}>
                    <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${BDR}`, background:CARD2, color:page===1?T3:T1, cursor:page===1?"not-allowed":"pointer", fontSize:13 }}>← Prev</button>
                    {Array.from({length:totalPages},(_,i)=>i+1).filter(p=>p===1||p===totalPages||Math.abs(p-page)<=1).reduce((acc,p,i,arr)=>{ if(i>0&&arr[i-1]!==p-1)acc.push("…"); acc.push(p); return acc; },[]).map((p,i)=>
                      p==="…"?<span key={`e${i}`} style={{ padding:"6px 4px", fontSize:13, color:T3 }}>…</span>
                      :<button key={p} onClick={()=>setPage(p)} style={{ padding:"6px 12px", borderRadius:8, fontSize:13, cursor:"pointer", border:"none", background:page===p?PINK:CARD2, color:page===p?"#fff":T1, fontWeight:page===p?600:400 }}>{p}</button>
                    )}
                    <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${BDR}`, background:CARD2, color:page===totalPages?T3:T1, cursor:page===totalPages?"not-allowed":"pointer", fontSize:13 }}>Next →</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT — Table Management ── */}
        {showTables && (
          <div style={{ minWidth:0 }}>
            <div className="op-card" style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:RADIUS, padding:14, position:"sticky", top:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700, color:T1 }}>Table Management</div>
                  <div style={{ fontSize:11, color:T3 }}>Tap a table to see its order</div>
                </div>
                <button onClick={()=>setShowTables(false)} style={{
                  padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600,
                  border:`1px solid ${BDR}`, background:CARD2, color:T2, cursor:"pointer",
                }}>✕ Hide</button>
              </div>

              {tablesLoading?(
                <div style={{ textAlign:"center", padding:32, color:T3, fontSize:13 }}>Loading tables…</div>
              ):tables.length===0?(
                <div style={{ textAlign:"center", padding:32, color:T3, fontSize:13 }}>No tables yet</div>
              ):(
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(88px,1fr))", gap:10 }}>
                  {tables
                    .slice()
                    .sort((a, b) => a.tableNo - b.tableNo)
                    .map((t) => {
                      const tableOrders = tableOrderMap[t.tableNo] || [];
                      const occupied = tableOrders.length > 0;
                      const isSel = tableSelected === t.tableNo;
                      const tableTotal = tableOrders.reduce((s, o) => s + Number(o.total || 0), 0);

                      let dominantStatus = null;
                      let st = DEFAULT_STATUS_STYLE;
                      if (occupied) {
                        const statusCounts = {};
                        tableOrders.forEach((o) => {
                          statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
                        });
                        dominantStatus = Object.keys(statusCounts).sort((a, b) => statusCounts[b] - statusCounts[a])[0];
                        st = STATUS_STYLE[dominantStatus] || DEFAULT_STATUS_STYLE;
                      }

                      return (
                        <div
                          key={t.tableNo}
                          className="op-card"
                          onClick={() => setTableSelected(isSel ? null : t.tableNo)}
                          style={{
                            background: CARD2,
                            border: `1px solid ${isSel ? PINK : occupied ? `${st.color}55` : BDR}`,
                            borderRadius: RADIUS,
                            padding: 12,
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 8,
                            boxShadow: isSel ? `0 0 0 3px ${PINK}22` : "none",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              aspectRatio: "1",
                              borderRadius: 9,
                              background: occupied ? st.bg : "rgba(255,255,255,0.03)",
                              border: `1px solid ${occupied ? `${st.color}44` : BDR}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: 18,
                              color: occupied ? st.color : T2,
                              position: "relative",
                            }}
                          >
                            T{t.tableNo}
                            {occupied && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: -8,
                                  right: -8,
                                  background: PINK,
                                  color: "#fff",
                                  borderRadius: "50%",
                                  width: 24,
                                  height: 24,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                              >
                                {tableOrders.length}
                              </div>
                            )}
                          </div>

                          <div style={{ fontSize: 10, color: T3, textAlign: "center" }}>{t.seats} seats</div>

                          {occupied ? (
                            <>
                              <Badge label={dominantStatus} map={STATUS_STYLE} format={formatStatus}/>
                              <div style={{ fontSize: 11, fontWeight: 700, color: st.color, fontFamily: "monospace", textAlign: "center" }}>
                                ₹{Math.round(tableTotal)}
                              </div>
                              <div style={{ fontSize: 9, color: T3, textAlign: "center" }}>
                                {tableOrders.reduce((s, o) => s + (o.items?.length || 0), 0)} items
                              </div>
                            </>
                          ) : (
                            <span style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
                              Free
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {tableSelected && (
                <MultiOrderTableView
                  orders={selectedTableOrders}
                  tableNo={tableSelected}
                  onStatusChange={(id,s)=>{ handleStatusChange(id,s); setTableSelected(null); }}
                  onPaymentChange={handlePaymentChange}
                  onCombinedBill={(mode,value)=>setShowCombinedBill({mode,value})}
                  onAddItems={(order)=>setShowAddItems(order._id)}
                />
              )}
            </div>
          </div>
        )}

      </div>

      {showCreate&&<CreateOrderModal onClose={()=>setShowCreate(false)} onCreated={o=>setOrders(prev=>[o,...prev])}/>}

      {showAddItems && (
        <AddItemsToOrderModal
          order={orders.find((o) => o._id === showAddItems)}
          onClose={() => setShowAddItems(null)}
          onItemsAdded={(updatedOrder) => {
            setOrders((prev) =>
              prev.map((o) =>
                o._id === updatedOrder._id ? updatedOrder : o
              )
            );
          }}
        />
      )}
      {showCombinedBill && (
        <CombinedBillModal
          mode={showCombinedBill.mode}
          value={showCombinedBill.value}
          onClose={()=>setShowCombinedBill(null)}
          onPaymentChange={fetchOrders}
        />
      )}
    </div>
  );
}