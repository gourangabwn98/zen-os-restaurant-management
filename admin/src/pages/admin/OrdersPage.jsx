import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import toast from "react-hot-toast";
import {
  getAllOrders, getRestaurantProfile, updateOrderStatus,
  getAllTables, printOrderBill, confirmOrder, rejectOrder,
} from "../../services/adminService.js";
import { placeOrder, newIdempotencyKey } from "../../services/orderService.js";
import { getSocket } from "../../services/socketService.js";
import { consumePendingOrderFocus } from "../../services/orderFocus.js";
import CombinedBillModal from "./shared/CombinedBillModal.jsx";
import { statusKind } from "./shared/statusKind.js";
import ErrorState from "./shared/ErrorState.jsx";
import EmptyState from "./shared/EmptyState.jsx";
import { getMenu, getCategories } from "../../services/menuService.js";

// ── add this to adminService.js if not already there ─────────────────────────
// export const updateOrderPayment = (id, data) => api.patch(`/admin/orders/${id}/payment`, data);

// ── Theme tokens (see src/theme/tokens.css) ────────────────────────────────
const PINK  = "var(--violet)";
const CARD  = "var(--card)";
const CARD2 = "var(--card-2)";
const BDR   = "var(--edge)";
const T1    = "var(--text-1)";
const T2    = "var(--text-2)";
const T3    = "var(--text-3)";
const RADIUS = 14;

// ── Status style lookup, derived from the shared semantic-kind map ──────────
// Keys are the raw canonical values stored on the order (see
// restaurant-server/utils/orderStateMachine.js). Display text is produced
// separately by the format* helpers / Badge's `format` prop.
const KIND_FILL = { wait: "var(--wait-fill)", live: "var(--live-fill)", ready: "var(--ready-fill)", done: "var(--done-fill)", stop: "var(--stop-fill)", vio: "var(--violet-weak)" };
const KIND_INK  = { wait: "var(--wait-ink)",  live: "var(--live-ink)",  ready: "var(--ready-ink)",  done: "var(--done-ink)",  stop: "var(--stop-ink)",  vio: "var(--accent-ink)" };
const KIND_LINE = { wait: "var(--wait-line)", live: "var(--live-line)", ready: "var(--ready-line)", done: "var(--done-line)", stop: "var(--stop-line)", vio: "var(--violet-mid)" };
const KIND_HUE  = { wait: "var(--wait)",      live: "var(--live)",      ready: "var(--ready)",      done: "var(--done)",      stop: "var(--stop)",      vio: "var(--violet)" };
const styleFor = (v) => {
  const k = statusKind(v);
  return { bg: KIND_FILL[k], color: KIND_INK[k], line: KIND_LINE[k] };
};

const DEFAULT_STATUS_STYLE = styleFor("");

const mkStyleMap = (values) => Object.fromEntries(values.map((v) => [v, styleFor(v)]));
const STATUS_STYLE = mkStyleMap(["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY", "DELIVERED", "COMPLETED", "CANCELLED"]);
const PAY_STYLE    = mkStyleMap(["PAID", "PENDING_VERIFICATION", "FAILED"]);
const TYPE_STYLE   = mkStyleMap(["DINE_IN", "TAKEAWAY", "ONLINE"]);

const STATUSES = ["All","PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"];
const ACTIVE_ORDER_STATUSES = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
const PAYMENT_STATUSES = ["All","PAID","PENDING_VERIFICATION","FAILED"];
const ORDER_TYPES = ["All","DINE_IN","TAKEAWAY"];

// Decorative avatar palette — brand/status hues, theme-invariant, white text
// (matches design-reference/zen-os-design-reference.html `avatar()`).
const AVATAR_GRADS = [
  "linear-gradient(140deg,#8B5CF6,#6D28D9)",
  "linear-gradient(140deg,#22D3EE,#0891B2)",
  "linear-gradient(140deg,#F0A93B,#D97706)",
  "linear-gradient(140deg,#35D08A,#059669)",
  "linear-gradient(140deg,#F2564D,#B91C1C)",
  "linear-gradient(140deg,#6366F1,#4338CA)",
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

const avc = (n) => AVATAR_GRADS[(n?.charCodeAt(0)||0) % AVATAR_GRADS.length];
const ini = (n) => !n||n==="Guest" ? "G" : n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const fmt = (n) => Math.round(n||0).toLocaleString("en-IN");

// ── Display formatters (keep raw values for logic, format only for text) ───
const formatStatus = (s="") =>
  s.replace(/_/g," ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const formatPayment = (s) => ({ PAID:"Paid", PENDING_VERIFICATION:"Pending", FAILED:"Failed" }[s] || formatStatus(s));
const formatOrderType = (s) => ({ DINE_IN:"Dine In", TAKEAWAY:"Takeaway", All:"All" }[s] || formatStatus(s));

// ── Shared hover / transition styles injected once ─────────────────────────
const GlobalOrdersStyle = () => (
  <style>{`
    .op-card { transition: box-shadow .2s ease, border-color .2s ease, var(--theme-transition); }
    .op-card:hover { border-color: var(--edge-hi); }
    .op-stat { transition: transform .15s ease, box-shadow .15s ease; }
    .op-stat:hover { transform: translateY(-2px); box-shadow: var(--shadow-card); }
    .op-row { transition: background .15s ease; }
    .op-row:hover { background: var(--violet-faint); }
    .op-btn { transition: filter .15s ease, transform .1s ease; }
    .op-btn:hover { filter: brightness(1.08); }
    .op-btn:active { transform: scale(0.98); }
    .op-chip { transition: background .15s ease, color .15s ease, border-color .15s ease; }
    .op-menu-card { transition: border-color .15s ease, background .15s ease, transform .1s ease; }
    .op-menu-card:hover { border-color: var(--violet-glow); }
    .op-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .op-scroll::-webkit-scrollbar-thumb { background: var(--edge-hi); border-radius: 8px; }
    .op-scroll::-webkit-scrollbar-track { background: transparent; }

    /* ── Billing layout ── */
    .op-pills { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .op-floor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 360px); gap: 16px; align-items: start; margin-bottom: 16px; }
    .op-detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .op-hide-narrow { display: block; }
    .op-only-narrow { display: none; }
    @media (max-width: 1040px) {
      .op-floor { grid-template-columns: 1fr; }
    }
    @media (max-width: 780px) {
      .op-hide-narrow { display: none !important; }
      .op-only-narrow { display: block; }
      .op-detail-grid { grid-template-columns: 1fr 1fr; }
    }
    .op-ocard {
      border: 1px solid var(--edge); border-radius: var(--r-row);
      background: var(--grad-panel); padding: 12px 13px; margin-bottom: 8px;
      cursor: pointer; transition: var(--theme-transition), border-color .12s ease;
    }
    .op-ocard:hover { border-color: var(--edge-hi); }
  `}</style>
);

// ── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ label, map, format }) => {
  const s = (map && map[label]) || styleFor(label);
  return (
    <span style={{ background:s.bg, color:s.color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, whiteSpace:"nowrap", border:`1px solid ${s.line}` }}>
      {format ? format(label) : label}
    </span>
  );
};

// ── BillMetric — compact reference-style pill (Billing's two dense rows) ──────
const BillMetric = ({ label, value, caption, tone, grad, onClick }) => (
  <div
    className="zc-metric sm"
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
    style={onClick ? { cursor: "pointer" } : undefined}
  >
    <div className="k">{label}</div>
    <div
      className={`v tnum${grad ? " gr" : ""}`}
      style={grad || !tone ? undefined : { color: tone }}
    >
      {value}
    </div>
    {caption && <div className="d">{caption}</div>}
  </div>
);

// ── section label (modal + detail) ──────────────────────────────────────────
const DLabel = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:T3, letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
    {children}
  </div>
);

// ── OrderDetailModal — full history of one order (reference "Order detail") ───
const OrderDetailModal = ({ order, onClose, onStatusChange, onPaymentChange, onCombinedBill, onPrint, onAddItems, onConfirm, onReject, actionBusy }) => {
  if (!order) return null;
  const isPending = order.status === "PENDING_CONFIRMATION";
  const displayName  = order.user?.name || order.guestName || "Guest";
  const displayPhone = order.guestPhone || order.user?.phone || null;
  const subtotal     = order.subtotal ?? order.items?.reduce((s,i)=>s+i.price*i.qty,0) ?? 0;
  const canAddItems  = ["CONFIRMED","PREPARING","READY"].includes(order.status);
  const canCancel    = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING"].includes(order.status);
  const placedAt     = new Date(order.createdAt).toLocaleString("en-IN",{ day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
  const timeline     = Array.isArray(order.statusHistory) ? order.statusHistory : [];

  const info = [
    ["Customer", displayName],
    ["Phone", displayPhone ? `+91 ${displayPhone}` : "—"],
    ["Type", formatOrderType(order.orderType)],
    ["Payment", `${order.paymentMethod || "Cash"} · ${formatPayment(order.paymentStatus)}`],
  ];
  const summary = [
    ["Subtotal", subtotal],
    ...(order.serviceCharge > 0 ? [["Service charge", order.serviceCharge]] : []),
    ...(order.tax > 0 ? [["GST", order.tax]] : []),
    ...(order.discount > 0 ? [["Discount", -order.discount]] : []),
  ];

  return (
    <div className="zc-scrim" onClick={onClose}>
      <div className="zc-modal" style={{ width:600 }} onClick={e=>e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex:1, minWidth:0 }}>
            <div className="t tnum">{order.orderId}</div>
            <div className="s">
              {order.tableNo ? `Table ${order.tableNo} · ` : ""}placed {placedAt}
            </div>
          </div>
          <span className={`zc-tag ${statusKind(order.status)}`}><i />{formatStatus(order.status)}</span>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mb">
          {/* ── Pending confirmation → prominent Confirm / Reject ── */}
          {isPending && (
            <div style={{
              display:"flex", gap:10, alignItems:"center", flexWrap:"wrap",
              padding:"12px 14px", marginBottom:18, borderRadius:12,
              border:"1px solid var(--wait-line)", background:"var(--wait-fill)",
            }}>
              <div style={{ flex:1, minWidth:140 }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:"var(--wait-ink)" }}>
                  Awaiting your confirmation
                </div>
                <div style={{ fontSize:11.5, color:T2, marginTop:2 }}>
                  Confirming sends the KOT to the kitchen and deducts stock.
                </div>
              </div>
              <button type="button" className="op-btn" disabled={actionBusy}
                onClick={()=>onConfirm?.(order)}
                style={{ padding:"9px 18px", borderRadius:10, border:"none", cursor:actionBusy?"wait":"pointer",
                  background:"var(--grad-btn)", color:"#fff", fontWeight:800, fontSize:13 }}>
                {actionBusy ? "Working…" : "✓ Confirm Order"}
              </button>
              <button type="button" className="op-btn" disabled={actionBusy}
                onClick={()=>onReject?.(order)}
                style={{ padding:"9px 16px", borderRadius:10, cursor:actionBusy?"wait":"pointer",
                  border:"1px solid var(--stop-line)", background:"var(--stop-fill)",
                  color:"var(--stop-ink)", fontWeight:700, fontSize:13 }}>
                ✕ Reject Order
              </button>
            </div>
          )}

          {/* info grid */}
          <div className="op-detail-grid" style={{ marginBottom:20 }}>
            {info.map(([k,v]) => (
              <div key={k} style={{ padding:"11px 13px", borderRadius:12, background:"var(--card-2)", border:"1px solid var(--edge)" }}>
                <div style={{ fontSize:10.5, color:T3 }}>{k}</div>
                <div style={{ fontSize:12.5, fontWeight:600, marginTop:3, color:T1, wordBreak:"break-word" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* items */}
          <DLabel>Items</DLabel>
          <div style={{ borderRadius:13, border:"1px solid var(--edge)", overflow:"hidden", marginBottom:20 }}>
            {order.items?.map((item,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:11, padding:"10px 14px", borderBottom:"1px solid var(--edge)", fontSize:12.5 }}>
                <span className="zc-q">{item.qty}</span>
                <span style={{ flex:1, fontWeight:500, color:T1 }}>{item.name}</span>
                <span className="tnum" style={{ fontWeight:600, color:T1 }}>₹{item.price * item.qty}</span>
              </div>
            ))}
            <div style={{ padding:"12px 14px", display:"grid", gap:6, fontSize:12.5, background:"var(--card-2)" }}>
              {summary.map(([k,v]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ color:T2 }}>{k}</span>
                  <span className="tnum" style={{ color:T1 }}>{v < 0 ? `−₹${Math.abs(v)}` : `₹${v}`}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:16, fontWeight:700, paddingTop:8, borderTop:"1px solid var(--edge)" }}>
                <span style={{ color:T1 }}>Total</span>
                <span className="tnum zc-grad-text">₹{Math.round(order.total)}</span>
              </div>
            </div>
          </div>

          {/* controls — status / payment / method (all preserved) */}
          <DLabel>Update order status</DLabel>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
            {STATUSES.filter(s => s !== "All" && s !== order.status).map(s => {
              const st = STATUS_STYLE[s] || DEFAULT_STATUS_STYLE;
              return (
                <button key={s} type="button" className="op-chip" onClick={()=>onStatusChange(order._id, s)}
                  style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${st.line}`, background:st.bg, color:st.color, cursor:"pointer", fontSize:12, fontWeight:600, font:"inherit" }}>
                  {formatStatus(s)}
                </button>
              );
            })}
          </div>

          <DLabel>Payment status</DLabel>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
            {["PENDING_VERIFICATION","PAID","FAILED"].map(s => {
              const st = PAY_STYLE[s] || DEFAULT_STATUS_STYLE;
              const active = order.paymentStatus === s;
              return (
                <button key={s} type="button" className="op-chip" onClick={()=>!active && onPaymentChange(order._id, { paymentStatus:s })}
                  style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, font:"inherit", cursor:active?"default":"pointer",
                    border:`1px solid ${st.line}`, background:active?st.bg:"transparent", color:st.color, opacity:active?1:0.55 }}>
                  {active ? "✓ " : ""}{formatPayment(s)}
                </button>
              );
            })}
          </div>

          <DLabel>Payment method</DLabel>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:timeline.length ? 20 : 0 }}>
            {["Cash","Online"].map(m => {
              const active = (order.paymentMethod || "Cash") === m;
              return (
                <button key={m} type="button" className="op-chip" onClick={()=>!active && onPaymentChange(order._id, { paymentMethod:m })}
                  style={{ padding:"6px 16px", borderRadius:20, fontSize:12, fontWeight:600, font:"inherit", cursor:active?"default":"pointer",
                    border:`2px solid ${active ? "var(--violet)" : "var(--edge)"}`,
                    background:active ? "var(--violet-weak)" : "var(--card-2)",
                    color:active ? "var(--accent-ink)" : T2 }}>
                  {m === "Cash" ? "💵" : "📱"} {m}
                </button>
              );
            })}
          </div>

          {/* timeline — real transitions from order.statusHistory */}
          {timeline.length > 0 && (
            <>
              <DLabel>Timeline</DLabel>
              <div className="zc-timeline">
                {timeline.map((entry, i) => {
                  const kind = statusKind(entry.status);
                  const tone = kind === "stop" ? "stop" : kind === "wait" ? "wait" : "done";
                  const who = entry.changedBy?.name
                    ? `${entry.changedBy.name}${entry.changedBy.role ? ` (${entry.changedBy.role.toLowerCase()})` : ""}`
                    : "—";
                  const when = entry.changedAt
                    ? new Date(entry.changedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })
                    : "";
                  return (
                    <div className="row" key={i}>
                      <div className="rail">
                        <span className={`node ${tone}`} />
                        {i < timeline.length - 1 && <span className="line" />}
                      </div>
                      <div className="body">
                        <div className="st">{formatStatus(entry.status)}</div>
                        <div className="meta">{who}{when ? ` · ${when}` : ""}{entry.note ? ` · ${entry.note}` : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="mf" style={{ flexWrap:"wrap" }}>
          {(order.guestPhone || order.user?.phone) && (
            <button type="button" className="zc-btn" onClick={()=>onCombinedBill?.("phone", order.guestPhone || order.user?.phone)}>
              🧾 Customer bill
            </button>
          )}
          {canAddItems && onAddItems && (
            <button type="button" className="zc-btn" onClick={()=>onAddItems(order)}>＋ Add items</button>
          )}
          <button type="button" className="zc-btn" onClick={()=>onPrint(order)}>🖨️ Print bill</button>
          {canCancel && (
            <button type="button" className="zc-btn danger" onClick={()=>onStatusChange(order._id, "CANCELLED")}>Cancel order</button>
          )}
        </div>
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

const CreateOrderModal = ({ onClose, onCreated, initialTableNo = null }) => {
  const [vegFilter,  setVegFilter]  = useState("All");
  const [tempFilter, setTempFilter] = useState("All");
  const [mi,          setMi]          = useState([]);
  const [selCat,      setSelCat]      = useState("All");
  const [search,      setSearch]      = useState("");
  const [cart,        setCart]        = useState([]);
  const [orderType,   setOrderType]   = useState("DINE_IN");
  // Pre-filled when opened by tapping a specific table on the floor map
  // (see openNewOrder in the parent) — saves re-typing a number just picked.
  const [tableNo,     setTableNo]     = useState(initialTableNo ? String(initialTableNo) : "");
  const [customerName,setCustomerName]= useState("");
  const [customerPhone,setCustomerPhone]=useState("");
  const [paymentMethod,setPaymentMethod]=useState("Cash");
  const [paymentStatus,setPaymentStatus]=useState("PENDING_VERIFICATION");
  const [loading,     setLoading]     = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [scpi,        setScpi]        = useState(0);
  const [gstRate,     setGstRate]     = useState(0);
  const [catImages, setCatImages] = useState({});
  const [idemKey] = useState(newIdempotencyKey);

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
        idempotencyKey: idemKey,
      });
      // Only a real persisted order comes back with a Mongo _id + orderId.
      if (!data?._id || !data?.orderId) throw new Error("Order was not created — please retry");
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
    <div className="zc-scrim" style={{ padding:12 }}>

      <div className="zc-modal" style={{ width:"100%", maxWidth:1300, height:"92vh",
        display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* ── TOP BAR ── */}
        <div style={{ display:"flex", alignItems:"center", gap:14,
          padding:"14px 20px", borderBottom:"1px solid var(--edge)", flexShrink:0 }}>

          <div style={{ flexShrink:0 }}>
            <div style={{ fontSize:16, fontWeight:700, letterSpacing:"-.02em", color:"var(--text-1)" }}>New order</div>
            <div style={{ fontSize:11.5, color:"var(--text-3)" }}>Select items to add</div>
          </div>

          <div style={{ flex:1, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search items…" className="zc-input" />
            {search && <button onClick={()=>setSearch("")}
              className="zc-btn ghost sm" style={{ flexShrink:0 }}>✕</button>}
          </div>

          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* ── LEFT: Category tabs (vertical) ── */}
          <div className="op-scroll" style={{ width:132, background:"var(--surface)",
            borderRight:"1px solid var(--edge)",
            display:"flex", flexDirection:"column", gap:4,
            overflowY:"auto", flexShrink:0, padding:"10px 8px" }}>
            {categories.map(cat=>{
              const active = selCat===cat;
              const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
              return (
                <button key={cat} onClick={()=>setSelCat(cat)} style={{
                  padding:"10px 6px", border:"none", borderRadius:"var(--r-ctl)", cursor:"pointer",
                  background:active?"var(--grad-btn)":"transparent",
                  boxShadow:active?"0 4px 12px -4px var(--violet-glow)":"none",
                  display:"flex", flexDirection:"column",
                  alignItems:"center", gap:4, transition:"var(--theme-transition)",
                }}>
                  {(() => {
                    const icon = getCatIcon(cat);
                    return icon?.startsWith?.("http")
                      ? <img src={icon} alt={cat}
                          onError={e=>e.target.style.display="none"}
                          style={{ width:32, height:32, borderRadius:7, objectFit:"cover" }}/>
                      : <span style={{ fontSize:19 }}>{icon}</span>;
                  })()}
                  <span style={{ fontSize:10.5, fontWeight:active?700:500,
                    color:active?"#fff":"var(--text-2)", textAlign:"center",
                    lineHeight:1.2, wordBreak:"break-word" }}>
                    {cat}
                  </span>
                  <span style={{ fontSize:9, color:active?"rgba(255,255,255,.75)":"var(--text-3)" }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* ── MIDDLE: Menu items grid ── */}
          <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:16 }}>

            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
              <div className="zc-seg">
                {[["All","🍽️ All"],["Veg","🟢 Veg"],["Non Veg","🔴 Non Veg"]].map(([v,label])=>(
                  <button key={v} onClick={()=>setVegFilter(v)} style={vegFilter===v ? {
                    background: v==="Veg" ? "var(--ready-fill)" : v==="Non Veg" ? "var(--stop-fill)" : "var(--grad-btn)",
                    color: v==="Veg" ? "var(--ready-ink)" : v==="Non Veg" ? "var(--stop-ink)" : "#fff",
                    fontWeight:600,
                  } : undefined}>{label}</button>
                ))}
              </div>

              {(isBeverageCat || selCat==="All") && (
                <div className="zc-seg">
                  {[["All","All"],["Hot","🔥 Hot"],["Cold","🧊 Cold"]].map(([v,label])=>(
                    <button key={v} onClick={()=>setTempFilter(v)} style={tempFilter===v ? {
                      background: v==="Hot" ? "var(--wait-fill)" : v==="Cold" ? "var(--live-fill)" : "var(--grad-btn)",
                      color: v==="Hot" ? "var(--wait-ink)" : v==="Cold" ? "var(--live-ink)" : "#fff",
                      fontWeight:600,
                    } : undefined}>{label}</button>
                  ))}
                </div>
              )}

              <span style={{ fontSize:12, color:"var(--text-3)", alignSelf:"center" }}>
                {filtered.length} item{filtered.length!==1?"s":""}
              </span>
            </div>

            {menuLoading ? (
              <div style={{ textAlign:"center", padding:60, color:"var(--text-3)" }}>
                <div className="zc-spin" style={{ margin:"0 auto 14px" }} />
                Loading menu…
              </div>
            ) : filtered.length===0 ? (
              <div style={{ textAlign:"center", padding:60, color:"var(--text-3)" }}>
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
                      background:inCart?"var(--violet-faint)":"var(--card-2)",
                      border:`1px solid ${inCart?"var(--violet-line)":"var(--edge)"}`,
                      borderRadius:"var(--r-card)", overflow:"hidden",
                      cursor:"pointer",
                      display:"flex", flexDirection:"column",
                      position:"relative", transition:"var(--theme-transition)",
                    }}>
                      <div style={{ height:100, background:"var(--card-2)",
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
                          background:"var(--grad-btn)", color:"#fff", borderRadius:"50%",
                          width:24, height:24, display:"flex",
                          alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700, boxShadow:"0 4px 10px -4px var(--violet-glow)" }}>{qty}</div>
                      )}

                      <div style={{ padding:"10px 10px 6px", flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:"var(--text-1)",
                          lineHeight:1.3, marginBottom:3 }}>{m.name}</div>
                        <div style={{ fontSize:11, color:"var(--text-3)" }}>{m.category}</div>
                        <div style={{ fontWeight:700, fontSize:15, color:"var(--text-1)",
                          marginTop:4 }}>₹{m.price}</div>
                      </div>

                      <div style={{ padding:"0 8px 10px",
                        display:"flex", alignItems:"center", gap:6 }}>
                        {qty===0 ? (
                          <button className="zc-btn pri sm" onClick={()=>addItem(m)} style={{ flex:1, justifyContent:"center" }}>+ Add</button>
                        ) : (
                          <>
                            <button onClick={()=>removeItem(m._id)} style={{
                              width:30, height:30, borderRadius:"50%",
                              border:"1px solid var(--violet-line)", background:"var(--violet-weak)",
                              color:"var(--accent-ink)", cursor:"pointer", fontWeight:700,
                              fontSize:18, display:"flex", alignItems:"center",
                              justifyContent:"center",
                            }}>−</button>
                            <span className="tnum" style={{ flex:1, textAlign:"center",
                              fontWeight:700, fontSize:16, color:"var(--text-1)" }}>{qty}</span>
                            <button onClick={()=>addItem(m)} style={{
                              width:30, height:30, borderRadius:"50%",
                              background:"var(--grad-btn)", color:"#fff", border:"none",
                              cursor:"pointer", fontWeight:700, fontSize:18,
                              display:"flex", alignItems:"center",
                              justifyContent:"center", boxShadow:"0 4px 10px -4px var(--violet-glow)",
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
          <div style={{ width:290, background:"var(--grad-rail)",
            borderLeft:"1px solid var(--edge)",
            display:"flex", flexDirection:"column", flexShrink:0 }}>

            {/* Cart header */}
            <div style={{ padding:"14px 14px 10px",
              borderBottom:"1px solid var(--edge)", flexShrink:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center" }}>
                <div style={{ fontWeight:700, fontSize:15, color:"var(--text-1)" }}>
                  🛒 Cart
                  {totalQty>0 && <span className="tnum" style={{ marginLeft:8, background:"var(--grad-btn)",
                    color:"#fff", borderRadius:"50%", width:20, height:20,
                    display:"inline-flex", alignItems:"center",
                    justifyContent:"center", fontSize:11, fontWeight:700,
                  }}>{totalQty}</span>}
                </div>
                {cart.length>0 && (
                  <button onClick={clearCart} style={{ background:"none",
                    border:"none", color:"var(--stop-ink)", cursor:"pointer",
                    fontSize:12, fontWeight:600 }}>Clear</button>
                )}
              </div>
            </div>

            {/* Order details */}
            <div style={{ padding:"12px 14px", borderBottom:"1px solid var(--edge)",
              flexShrink:0, display:"flex", flexDirection:"column", gap:8 }}>

              {/* Order type */}
              <div className="zc-seg" style={{ width:"100%" }}>
                {ORDER_TYPE_OPTIONS.map(({value,label,icon})=>(
                  <button key={value} onClick={()=>setOrderType(value)}
                    className={orderType===value ? "on" : ""} style={{ flex:1, justifyContent:"center" }}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Table number — only for Dining */}
              {orderType==="DINE_IN" && (
                <div style={{ display:"flex", alignItems:"center", gap:8,
                  background:"var(--card-2)", border:`1px solid ${tableNo?"var(--violet-line)":"var(--edge)"}`,
                  borderRadius:"var(--r-ctl)", padding:"6px 14px" }}>
                  <span style={{ fontSize:13, color:"var(--text-2)", fontWeight:500 }}>Table</span>
                  <input type="number" min={1} value={tableNo}
                    onChange={e=>setTableNo(e.target.value)}
                    placeholder="No."
                    style={{ flex:1, background:"transparent", border:"none",
                      outline:"none", fontSize:15, fontWeight:700, color:"var(--text-1)",
                      textAlign:"center" }}/>
                </div>
              )}

              {/* Customer name */}
              <input value={customerName} onChange={e=>setCustomerName(e.target.value)}
                placeholder="Customer name" className="zc-input" />

              {/* Customer phone */}
              <input value={customerPhone}
                onChange={e=>setCustomerPhone(e.target.value.replace(/\D/g,""))}
                maxLength={10} placeholder="Phone number" className="zc-input" />

              {/* Payment Method */}
              <div className="zc-seg" style={{ width:"100%" }}>
                {["Cash","Online"].map(m=>(
                  <button key={m} onClick={()=>setPaymentMethod(m)}
                    className={paymentMethod===m ? "on" : ""} style={{ flex:1, justifyContent:"center" }}>
                    {m==="Cash"?"💵 Cash":"📱 Online"}
                  </button>
                ))}
              </div>

              {/* Payment Status */}
              <div className="zc-seg" style={{ width:"100%" }}>
                {PAYMENT_STATUS_OPTIONS.map(({value,label,icon})=>{
                  const st = PAY_STYLE[value] || DEFAULT_STATUS_STYLE;
                  const active = paymentStatus===value;
                  return (
                    <button key={value} onClick={()=>setPaymentStatus(value)} style={{
                      flex:1, justifyContent:"center",
                      background:active?st.bg:"transparent",
                      color:active?st.color:"var(--text-2)",
                      fontWeight:active?600:500,
                    }}>{icon} {label}</button>
                  );
                })}
              </div>

              {/* WhatsApp notice */}
              {customerPhone?.length===10 && (
                <span style={{ fontSize:11, color:"var(--ready-ink)" }}>
                  📱 Will notify +91 {customerPhone}
                </span>
              )}
            </div>

            {/* Cart items */}
            <div className="op-scroll" style={{ flex:1, overflowY:"auto", padding:"10px 14px" }}>
              {cart.length===0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text-3)" }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>🛒</div>
                  <div style={{ fontSize:13 }}>No items yet</div>
                  <div style={{ fontSize:11, marginTop:4 }}>Tap items to add</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {cart.map(c=>(
                    <div key={c.item._id} className="zc-panel" style={{
                      display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
                    }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:"var(--text-1)",
                          overflow:"hidden", textOverflow:"ellipsis",
                          whiteSpace:"nowrap" }}>{c.item.name}</div>
                        <div className="tnum" style={{ fontSize:11, color:"var(--text-3)" }}>
                          ₹{c.item.price} × {c.qty}
                        </div>
                      </div>
                      <div className="tnum" style={{ fontWeight:700, color:"var(--text-1)", fontSize:13,
                        minWidth:44, textAlign:"right" }}>
                        ₹{c.item.price*c.qty}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <button onClick={()=>removeItem(c.item._id)} style={{
                          width:24, height:24, borderRadius:"50%",
                          border:"1px solid var(--edge)", background:"var(--card-2)",
                          color:"var(--text-2)", cursor:"pointer", fontWeight:700,
                          fontSize:14, display:"flex", alignItems:"center",
                          justifyContent:"center",
                        }}>−</button>
                        <button onClick={()=>addItem(c.item)} style={{
                          width:24, height:24, borderRadius:"50%",
                          background:"var(--grad-btn)", color:"#fff", border:"none",
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
                borderTop:"1px solid var(--edge)", flexShrink:0 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:5,
                  marginBottom:12 }}>
                  <div className="tnum" style={{ display:"flex", justifyContent:"space-between",
                    fontSize:12, color:"var(--text-2)" }}>
                    <span>Subtotal</span><span>₹{subtotal}</span>
                  </div>
                  {tax>0 && <div className="tnum" style={{ display:"flex",
                    justifyContent:"space-between", fontSize:12, color:"var(--text-2)" }}>
                    <span>GST ({gstRate}%)</span><span>₹{tax}</span>
                  </div>}
                  {scAmt>0 && <div className="tnum" style={{ display:"flex",
                    justifyContent:"space-between", fontSize:12, color:"var(--text-2)" }}>
                    <span>Service</span><span>₹{scAmt}</span>
                  </div>}
                  <div className="tnum" style={{ display:"flex", justifyContent:"space-between",
                    fontWeight:700, fontSize:17, paddingTop:8,
                    borderTop:"1px solid var(--edge)", marginTop:4 }}>
                    <span style={{ color:"var(--text-1)" }}>Total</span>
                    <span className="zc-grad-text">₹{total}</span>
                  </div>
                </div>

                <button className="zc-btn pri" onClick={handleSubmit}
                  disabled={loading||cart.length===0}
                  style={{ width:"100%", justifyContent:"center", padding:"13px 0", fontSize:14 }}>
                  {loading?"Placing…":`Place Order · ₹${total}`}
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
    <div style={{ position:"fixed", inset:0, background:"var(--scrim)", zIndex:999,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:12, backdropFilter:"blur(6px)" }}>

      <div style={{ background:"var(--surface)", borderRadius:20, width:"100%", maxWidth:1300,
        height:"92vh", display:"flex", flexDirection:"column",
        border:`1px solid var(--violet-mid)`,
        boxShadow:"var(--shadow-pop)", overflow:"hidden" }}>

        {/* ── TOP BAR ── */}
        <div style={{ display:"flex", alignItems:"center", gap:12,
          padding:"14px 20px", borderBottom:`1px solid ${BDR}`,
          background:"var(--card)", flexShrink:0 }}>

          <div style={{ display:"flex", flexDirection:"column" }}>
            <span style={{ fontWeight:700, fontSize:15, color:T1 }}>
              Add Items to Order
            </span>
            <span style={{ fontSize:12, color:T2, marginTop:2 }}>
              {order.orderId} · {order.guestName||order.user?.name||"Guest"}
              {order.tableNo ? ` · T${order.tableNo}` : ""}
              · <span style={{ color:isPaid?"var(--ready-ink)":"var(--wait-ink)", fontWeight:600 }}>
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
          <div className="op-scroll" style={{ width:150, background:"var(--bg)",
            borderRight:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column",
            overflowY:"auto", flexShrink:0 }}>
            {categories.map(cat=>{
              const active = selCat===cat;
              const count  = cat==="All" ? mi.length : mi.filter(m=>m.category===cat).length;
              return (
                <button key={cat} onClick={()=>setSelCat(cat)} style={{
                  padding:"14px 8px", border:"none", cursor:"pointer",
                  background:active?`var(--violet-weak)`:"transparent",
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
                      ? (v==="Veg"?"var(--ready-line)"
                        : v==="Non Veg"?"var(--stop-line)"
                        : PINK)
                      : "transparent",
                    color:vegFilter===v
                      ? (v==="Veg"?"var(--ready-ink)"
                        : v==="Non Veg"?"var(--stop-ink)"
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
                        ? (v==="Hot"?"var(--wait-line)"
                          : v==="Cold"?"var(--live-line)"
                          : PINK)
                        : "transparent",
                      color:tempFilter===v
                        ? (v==="Hot"?"var(--wait-ink)"
                          : v==="Cold"?"var(--live-ink)"
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
                      background:inCart?`var(--violet-faint)`:CARD2,
                      border:`2px solid ${inCart?PINK:BDR}`,
                      borderRadius:RADIUS, overflow:"hidden",
                      display:"flex", flexDirection:"column",
                      position:"relative",
                    }}>
                      <div style={{ height:100, background:"var(--card-2)",
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
                            background:"var(--grad-btn)",
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
          <div style={{ width:280, background:"var(--card)",
            borderLeft:`1px solid ${BDR}`,
            display:"flex", flexDirection:"column", flexShrink:0 }}>

            <div style={{ padding:"14px 14px 10px",
              borderBottom:`1px solid ${BDR}`, flexShrink:0 }}>
              <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1,
                textTransform:"uppercase", marginBottom:8 }}>Current Order</div>
              <div style={{ background:CARD2, borderRadius:8, padding:10,
                border:`1px solid ${isPaid?"var(--ready-line)":"var(--wait-line)"}` }}>
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
                    background:isPaid?"var(--ready-fill)":"var(--wait-fill)",
                    color:isPaid?"var(--ready-ink)":"var(--wait-ink)" }}>
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
                    border:"none", color:"var(--stop-ink)", cursor:"pointer",
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
                  background:loading?"var(--raise)":"var(--grad-btn)",
                  color:loading?T3:"#fff", fontWeight:800, fontSize:14,
                  cursor:loading?"not-allowed":"pointer",
                  boxShadow:loading?"none":`0 6px 20px var(--violet-line)`,
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

const MultiOrderTableView = ({ orders, tableNo, onStatusChange, onPaymentChange, onCombinedBill, onAddItems, onNewOrder }) => {
  const [expandedOrder, setExpandedOrder] = useState(null);

  if (orders.length === 0) {
    return (
      <div style={{ marginTop:14, textAlign:"center", padding:24, color:T3,
        fontSize:12, border:`1px dashed ${BDR}`, borderRadius:RADIUS }}>
        <div style={{ marginBottom:12 }}>Table {tableNo} is free</div>
        <button
          type="button"
          onClick={() => onNewOrder?.(tableNo)}
          className="zc-btn pri"
          style={{ justifyContent:"center" }}
        >
          ＋ New order for Table {tableNo}
        </button>
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
          <div style={{ fontSize:10, fontWeight:700, color:"var(--stop-ink)", letterSpacing:1,
            textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--stop-ink)" }}/>
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
          <div style={{ fontSize:10, fontWeight:700, color:"var(--ready-ink)", letterSpacing:1,
            textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--ready-ink)" }}/>
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

      <div style={{ padding:14, background:`var(--violet-faint)`, borderRadius:RADIUS,
        border:`1px solid var(--violet-mid)`, marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:600, color:T2, textTransform:"uppercase",
          letterSpacing:1, marginBottom:10 }}>Table Bill Summary</div>

        {orders.map((o,i) => {
          const paid = o.paymentStatus==="PAID";
          return (
            <div key={o._id} style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center", padding:"5px 0",
              borderBottom:`1px solid var(--edge)`, fontSize:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%",
                  background:paid?"var(--ready-ink)":"var(--stop-ink)", flexShrink:0 }}/>
                <span style={{ color:T2 }}>
                  {o.user?.name||o.guestName||`Order ${i+1}`}
                </span>
                <span style={{ fontSize:10, color:T3 }}>({o.items?.length||0} items)</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:11,
                  color:paid?"var(--ready-ink)":"var(--wait-ink)",
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
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--ready-ink)", marginBottom:4 }}>
              <span>✓ Paid</span><span>₹{Math.round(paidTotal)}</span>
            </div>
          )}
          {dueTotal > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13,
              fontWeight:700, color:"var(--stop-ink)", marginBottom:4 }}>
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
            border:`1px solid var(--violet-mid)`, background:`var(--violet-faint)`,
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

  const borderColor = isPaid ? "var(--ready-line)" : "var(--wait-line)";
  const bgColor     = isPaid ? "var(--ready-fill)" : "var(--wait-fill)";

  return (
    <div style={{ marginBottom:6, borderRadius:RADIUS, overflow:"hidden",
      border:`1px solid ${isExpanded ? "var(--violet-line)" : borderColor}`,
      background: isExpanded ? `var(--violet-faint)` : bgColor }}>

      <div onClick={onExpand} className="op-row" style={{ padding:"11px 13px", display:"flex",
        alignItems:"center", gap:10, cursor:"pointer" }}>

        <div style={{ width:30, height:30, borderRadius:"50%", background:av, color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, fontWeight:700, flexShrink:0 }}>
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
                padding:"5px 0", borderBottom:`1px solid var(--edge)`, fontSize:12 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ width:20, height:20, borderRadius:5, background:`var(--violet-weak)`,
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
                      style={{ padding:"4px 10px", borderRadius:20, border:`1px solid ${st.line}`,
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
                      border:`1px solid ${st.line}`,
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
                      background:active?`var(--violet-weak)`:CARD2,
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
                  border:`1px solid var(--violet-mid)`, background:`var(--violet-faint)`, color:PINK, cursor:"pointer" }}>
                + Add items
              </button>
            )}
            {displayPhone && onCombinedBill && (
              <button className="op-btn" onClick={()=>onCombinedBill("phone", displayPhone)}
                style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600,
                  border:"1px solid var(--violet-glow)", background:"var(--violet-faint)",
                  color:"var(--accent-ink)", cursor:"pointer" }}>
                🧾 Customer Bill
              </button>
            )}
            <button className="op-btn" onClick={async()=>{
              try{
                await printOrderBill(order._id);
                toast.success("Bill sent to printer ✓");
              }catch{ toast.error("Printer not running"); }
            }} style={{ padding:"5px 12px", borderRadius:8, fontSize:12, cursor:"pointer",
              border:"1px solid var(--ready-line)", background:"var(--ready-fill)",
              color:"var(--ready-ink)", whiteSpace:"nowrap" }}>
              🖨️ Bill
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// AWAITING CONFIRMATION — Modal listing every PENDING_CONFIRMATION order
// ══════════════════════════════════════════════════════════════════════════════
const PendingOrdersModal = ({ orders, busy, onConfirm, onReject, onClose }) => {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Oldest first — the one that's been waiting longest is the one to act on first.
  const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <div className="zc-scrim" onClick={onClose}>
      <div className="zc-modal" style={{ width: 640, maxHeight: "84vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">Awaiting confirmation</div>
            <div className="s">{orders.length} order{orders.length === 1 ? "" : "s"} yet to be confirmed</div>
          </div>
          <button type="button" className="zc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mb" style={{ overflowY: "auto", flex: 1 }}>
          {sorted.length === 0 ? (
            <EmptyState
              icon={<span style={{ fontSize: 26 }}>✅</span>}
              title="Queue clear"
              sub="No orders are waiting on a confirmation right now."
            />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {sorted.map((o) => {
                const name = o.guestName || o.user?.name || "Guest";
                const phone = o.guestPhone || o.user?.phone || null;
                const waitMin = Math.max(0, Math.round((new Date().getTime() - new Date(o.createdAt).getTime()) / 60000));
                const overdue = waitMin >= 10;
                return (
                  <div key={o._id} className="zc-panel" style={{ padding: 13, borderColor: overdue ? "var(--stop-line)" : undefined }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%", background: avc(name), color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                      }}>{ini(name)}</div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{name}</div>
                          <div className="tnum" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", flexShrink: 0 }}>₹{Math.round(o.total)}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                          {o.orderId} · {phone ? `+91 ${phone}` : "No phone"}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.items?.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                          {o.tableNo
                            ? <span className="zc-tag vio sq">T{o.tableNo}</span>
                            : <span className="zc-tag done sq">{formatStatus(o.orderType) || "Takeaway"}</span>}
                          <span className={`zc-tag ${overdue ? "stop" : "wait"}`}><i />Waiting {waitMin} min</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                      <button type="button" className="zc-btn pri sm" style={{ flex: 1, justifyContent: "center" }}
                        disabled={busy} onClick={() => onConfirm(o)}>
                        ✓ Confirm
                      </button>
                      <button type="button" className="zc-btn danger sm" style={{ flex: 1, justifyContent: "center" }}
                        disabled={busy} onClick={() => onReject(o)}>
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
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
  const [presetTableNo,setPresetTableNo]=useState(null);
  // Opens the New order form. Passing a table number (e.g. from tapping a
  // free table on the map) pre-fills it there instead of leaving the admin
  // to re-type a number they already picked.
  const openNewOrder = (tableNo = null) => { setPresetTableNo(tableNo); setShowCreate(true); };
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
  const [error, setError] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [actionBusy, setActionBusy] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const PER_PAGE=15;

  // ── Insert-or-update one order in local state, keyed by Mongo _id ──────────
  // Used by every realtime path so a socket event that arrives twice (or races
  // the initial fetch) can never create a duplicate row.
  const upsertOrder = useCallback((incoming) => {
    if (!incoming?._id) return;
    setOrders((prev) => {
      const i = prev.findIndex((o) => o._id === incoming._id);
      if (i === -1) return [incoming, ...prev];
      const next = [...prev];
      next[i] = { ...next[i], ...incoming };
      return next;
    });
  }, []);

  const fetchTables=useCallback(()=>{ getAllTables().then(r=>{setTables(r.data?.tables||[]);setTablesLoading(false);}).catch(()=>setTablesLoading(false)); },[]);
  useEffect(()=>{ fetchTables(); },[fetchTables]);

  const fetchOrders=useCallback(()=>{
    getAllOrders({ limit:10000 })
      .then(r=>{ setOrders(r.data?.orders||[]); setError(false); setLoading(false); })
      .catch(()=>{ setError(true); setLoading(false); });
  },[]);
  useEffect(()=>{ fetchOrders(); },[fetchOrders]);

  // ── Realtime: keep the list live off the SAME socket the notification bell
  // already uses (staff room). No polling. Every handler goes through
  // upsertOrder so duplicate/replayed events are idempotent, and listeners are
  // removed on unmount / socket change so a reconnect can't stack them up.
  useEffect(()=>{
    const socket = getSocket();
    if (!socket) return;

    const onNew        = (p)=>{ if (p?.order) upsertOrder(p.order); };
    const onConfirmed  = (p)=>{ if (p?.order) upsertOrder(p.order); };
    const onStatus     = (p)=>{ if (p?.order) upsertOrder(p.order); };
    const onCancelled  = (p)=>{ if (p?.order) upsertOrder(p.order); };
    const onPayment    = (p)=>{ if (p?.order) upsertOrder(p.order); };

    socket.on("order:new",             onNew);
    socket.on("order:confirmed",       onConfirmed);
    socket.on("order:status_changed",  onStatus);
    socket.on("order:cancelled",       onCancelled);
    socket.on("order:payment_changed", onPayment);

    return ()=>{
      socket.off("order:new",             onNew);
      socket.off("order:confirmed",       onConfirmed);
      socket.off("order:status_changed",  onStatus);
      socket.off("order:cancelled",       onCancelled);
      socket.off("order:payment_changed", onPayment);
    };
  },[upsertOrder]);

  // ── Clicking a notification (in NotificationBell) opens that order here ────
  const [pendingFocus, setPendingFocus] = useState(null); // { _id?, orderId? }
  const applyFocus = useCallback((target)=>{
    if (!target || (!target._id && !target.orderId)) return;
    setViewMode("all");           // "all" view isn't status/date-limited — the order is always reachable
    setSearch(""); setFilter("All"); setTypeF("All"); setPayF("All");
    setStartDate(""); setEndDate(""); setPage(1);
    setPendingFocus({ _id: target._id, orderId: target.orderId });
    fetchOrders();                // make sure a very-fresh order is pulled in
  },[fetchOrders]);

  useEffect(()=>{
    // Drain a focus request that fired before this page was mounted
    // (notification clicked from another admin screen).
    const queued = consumePendingOrderFocus();
    if (queued) applyFocus(queued);
    const onFocus=(e)=>{ consumePendingOrderFocus(); applyFocus(e.detail); };
    window.addEventListener("zc:focus-order", onFocus);
    return ()=>window.removeEventListener("zc:focus-order", onFocus);
  },[applyFocus]);

  // Resolve a pending focus once the target order is actually in state.
  useEffect(()=>{
    if (!pendingFocus) return;
    const hit = orders.find((o)=>
      (pendingFocus._id && o._id===pendingFocus._id) ||
      (pendingFocus.orderId && o.orderId===pendingFocus.orderId));
    if (hit) { setExpanded(hit._id); setPendingFocus(null); }
  },[pendingFocus, orders]);

  useEffect(()=>{
    const on=()=>setOnline(true), off=()=>setOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return ()=>{ window.removeEventListener("online",on); window.removeEventListener("offline",off); };
  },[]);

  useEffect(()=>{
    const handleKeyDown=(e)=>{
      if(showCreate) return;
      const tag=document.activeElement?.tagName;
      const isTyping=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||document.activeElement?.isContentEditable;
      if(isTyping) return;
      if(e.key.toLowerCase()==="n"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){ e.preventDefault(); openNewOrder(); }
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
    catch(e){ toast.error(e?.response?.data?.message || "Update failed"); }
  };

  // ── Confirm / Reject a PENDING_CONFIRMATION order ─────────────────────────
  // Both go through the existing backend state machine
  // (PATCH /orders/:id/confirm → CONFIRMED + KOT + stock deduction;
  //  PATCH /orders/:id/reject  → CANCELLED, order kept for history). The
  // backend also emits the realtime event that updates every other screen —
  // the local upsert here is just so the acting admin sees it instantly even
  // if their own socket round-trip is a beat behind.
  const handleConfirm = async (order) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const { data } = await confirmOrder(order._id);
      const updated = data?.order || data;
      if (updated?._id) upsertOrder(updated);
      toast.success(`Order ${order.orderId} confirmed · KOT sent`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Couldn't confirm this order");
    } finally { setActionBusy(false); }
  };

  const handleReject = async (order) => {
    if (actionBusy) return;
    if (!window.confirm(`Reject order ${order.orderId}? This cannot be undone. The order stays in history as cancelled.`)) return;
    const reason = (window.prompt("Reason for rejecting (optional):", "") || "").trim();
    setActionBusy(true);
    try {
      const { data } = await rejectOrder(order._id, reason || undefined);
      const updated = data?.order || data;
      if (updated?._id) upsertOrder(updated);
      toast.success(`Order ${order.orderId} rejected`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Couldn't reject this order");
    } finally { setActionBusy(false); }
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

  // ── Live floor state — deliberately ALL-TIME, not today-only ───────────────
  // tableOrderMap (above) already ignores the calendar day so a table stays
  // "occupied" for an order still active from before midnight; these two
  // mirror that for the page header / Table Map card subtitle. The stat-row
  // pills below are the ones scoped to today, per the admin's request.
  const now = new Date();
  const activeOrders = orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status));
  const occupiedTables = Object.keys(tableOrderMap).length;

  // ── Billing pill data — all real aggregates, ALL scoped to today ───────────
  const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === now.toDateString());
  const countStatus = (s, todayOnly) =>
    (todayOnly ? todayOrders : orders).filter((o) => o.status === s).length;
  const valueOfStatus = (s, todayOnly) =>
    (todayOnly ? todayOrders : orders)
      .filter((o) => o.status === s)
      .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const todayActiveOrders = todayOrders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status));
  const todayActiveValue = todayActiveOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const dueOrdersToday = todayOrders.filter(
    (o) => o.paymentStatus === "PENDING_VERIFICATION" && o.status !== "CANCELLED",
  );
  const dueTotalToday = dueOrdersToday.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayOrdersValue = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const collectedToday = todayOrders
    .filter((o) => o.paymentStatus === "PAID")
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const todayDineIn = todayActiveOrders.filter((o) => o.orderType === "DINE_IN" && o.tableNo);
  const occupiedTablesToday = new Set(todayDineIn.map((o) => Number(o.tableNo))).size;
  const floorTotalToday = todayDineIn.reduce((s, o) => s + Number(o.total || 0), 0);
  const readyLabelsToday = todayActiveOrders
    .filter((o) => o.status === "READY")
    .map((o) => (o.tableNo ? `T${o.tableNo}` : "Takeaway"));
  const oldestAwaitingMin = (() => {
    const pending = todayOrders.filter((o) => o.status === "PENDING_CONFIRMATION");
    if (!pending.length) return null;
    const oldest = Math.min(...pending.map((o) => new Date(o.createdAt).getTime()));
    return Math.max(1, Math.round((now.getTime() - oldest) / 60000));
  })();

  // Row 1 — today's operational snapshot.
  const STAT_ROW = [
    {
      label: "Payment due",
      value: dueOrdersToday.length,
      caption: `of ${todayOrders.length} today · ₹${fmt(dueTotalToday)} outstanding`,
      tone: "var(--stop-ink)",
    },
    {
      label: "Active orders",
      value: todayActiveOrders.length,
      caption: `of ${todayOrders.length} today · ₹${fmt(todayActiveValue)} in progress`,
      grad: true,
    },
    {
      label: "Awaiting confirmation",
      value: countStatus("PENDING_CONFIRMATION", true),
      caption: oldestAwaitingMin ? `Oldest waiting ${oldestAwaitingMin} min` : "Queue clear",
      tone: "var(--wait-ink)",
      onClick: () => setShowPending(true),
    },
    {
      label: "Total orders",
      value: todayOrders.length,
      caption: `₹${fmt(todayOrdersValue)} today · ₹${fmt(collectedToday)} collected`,
      grad: true,
    },
    {
      label: "Open tables",
      value: occupiedTablesToday,
      caption: tables.length
        ? `of ${tables.length} · ₹${fmt(floorTotalToday)} on the floor`
        : `₹${fmt(floorTotalToday)} on the floor`,
      grad: true,
    },
  ];

  // Row 2 — today's order-status funnel.
  const STAGE_ROW = [
    {
      label: "Preparing",
      value: countStatus("PREPARING", true),
      caption: `₹${fmt(valueOfStatus("PREPARING", true))} in the kitchen`,
      tone: KIND_INK[statusKind("PREPARING")],
    },
    {
      label: "Ready to serve",
      value: countStatus("READY", true),
      caption: readyLabelsToday.length ? readyLabelsToday.slice(0, 4).join(", ") : "None waiting",
      tone: KIND_INK[statusKind("READY")],
    },
    {
      label: "Delivered",
      value: countStatus("DELIVERED", true),
      caption: `₹${fmt(valueOfStatus("DELIVERED", true))} out with waiter`,
      tone: KIND_INK[statusKind("DELIVERED")],
    },
    {
      label: "Completed today",
      value: countStatus("COMPLETED", true),
      caption: `₹${fmt(valueOfStatus("COMPLETED", true))} billed today`,
      tone: KIND_INK[statusKind("COMPLETED")],
    },
    {
      label: "Cancelled",
      value: countStatus("CANCELLED", true),
      caption: `of ${todayOrders.length} today · ₹${fmt(valueOfStatus("CANCELLED", true))} lost`,
      tone: KIND_INK[statusKind("CANCELLED")],
    },
  ];

  const clearFilters = () => {
    setSearch(""); setFilter("All"); setTypeF("All"); setPayF("All");
    setStartDate(""); setEndDate(""); setPage(1);
  };
  const hasFilters =
    search || filter !== "All" || typeF !== "All" || payF !== "All" || startDate || endDate;

  const handlePrint = async (o) => {
    try {
      await printOrderBill(o._id);
      toast.success("Bill sent to printer ✓");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Printer not running");
    }
  };

  const detailOrder = expanded ? orders.find((o) => o._id === expanded) || null : null;

  const pageList = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1] !== p - 1) acc.push("…");
      acc.push(p);
      return acc;
    }, []);

  const rowActions = (o) => {
    const canAddItems = ["CONFIRMED", "PREPARING", "READY"].includes(o.status);
    return (
      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        {o.status === "PENDING_CONFIRMATION" && (
          <>
            <button type="button" className="op-btn" title="Confirm order" disabled={actionBusy}
              onClick={() => handleConfirm(o)}
              style={{ padding: "5px 10px", borderRadius: 8, border: "none", background: "var(--grad-btn)",
                color: "#fff", fontWeight: 800, fontSize: 12, cursor: actionBusy ? "wait" : "pointer" }}>
              ✓ Confirm
            </button>
            <button type="button" className="op-btn" title="Reject order" disabled={actionBusy}
              onClick={() => handleReject(o)}
              style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid var(--stop-line)",
                background: "var(--stop-fill)", color: "var(--stop-ink)", fontWeight: 700, fontSize: 12,
                cursor: actionBusy ? "wait" : "pointer" }}>
              ✕
            </button>
          </>
        )}
        {canAddItems && (
          <button type="button" className="zc-btn sm" title="Add items"
            onClick={() => setShowAddItems(o._id)} style={{ padding: "5px 8px" }}>＋</button>
        )}
        <button type="button" className="zc-btn sm" title="Print bill"
          onClick={() => handlePrint(o)} style={{ padding: "5px 8px" }}>🖨️</button>
      </div>
    );
  };

  return (
    <div>
      <GlobalOrdersStyle />

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.025em", color: "var(--text-1)", margin: 0 }}>
            Billing
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>
            {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            {" · "}
            {activeOrders.length} order{activeOrders.length !== 1 ? "s" : ""} on the floor
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="zc-live-dot" style={online ? undefined : { color: "var(--stop-ink)" }}>
            <i style={online ? undefined : { background: "var(--stop)", boxShadow: "0 0 9px var(--stop)" }} />
            {online ? "Live" : "Offline"}
          </span>
          <input
            className="zc-input"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search order, customer or phone"
            style={{ minWidth: 190, maxWidth: 260 }}
          />
          <button type="button" className="zc-btn pri" onClick={() => openNewOrder()}>
            ＋ New order
            <span style={{ fontSize: 10, fontWeight: 700, background: "var(--edge-hi)", padding: "1px 5px", borderRadius: 5 }}>N</span>
          </button>
        </div>
      </div>

      {/* ── Two pill rows ── */}
      <div className="op-pills" style={{ marginBottom: 8 }}>
        {STAT_ROW.map((m) => <BillMetric key={m.label} {...m} />)}
      </div>
      <div className="op-pills" style={{ marginBottom: 16 }}>
        {STAGE_ROW.map((m) => <BillMetric key={m.label} {...m} />)}
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div className="zc-seg">
          <button type="button" className={viewMode === "recent" ? "on" : ""}
            onClick={() => { setViewMode("recent"); setPage(1); }}>Recent · Today</button>
          <button type="button" className={viewMode === "all" ? "on" : ""}
            onClick={() => { setViewMode("all"); setPage(1); }}>All Orders</button>
        </div>
        <button
          type="button"
          onClick={() => setShowTables((t) => !t)}
          style={{
            display: "flex", alignItems: "center", gap: 9,
            padding: "6px 13px 6px 15px", borderRadius: "var(--r-ctl)", cursor: "pointer", font: "inherit",
            border: `1px solid ${showTables ? "var(--violet-line)" : "var(--edge)"}`,
            background: "var(--card-2)", color: showTables ? "var(--text-1)" : "var(--text-2)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500 }}>Table map</span>
          <span style={{
            width: 32, height: 18, borderRadius: 20, position: "relative", flex: "none",
            background: showTables ? "var(--grad-btn)" : "var(--edge-hi)", transition: "background .15s",
          }}>
            <span style={{
              position: "absolute", top: 2, [showTables ? "right" : "left"]: 2,
              width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "all .15s",
            }} />
          </span>
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {viewMode === "all" ? `${orders.length} orders total` : `${recentFiltered.length} active today`}
        </span>
      </div>

      {/* ── All-orders filter row ── */}
      {viewMode === "all" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <select className="zc-select" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} style={{ width: "auto" }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o === "All" ? "All statuses" : formatStatus(o)}</option>)}
          </select>
          <select className="zc-select" value={typeF} onChange={(e) => { setTypeF(e.target.value); setPage(1); }} style={{ width: "auto" }}>
            {ORDER_TYPES.map((o) => <option key={o} value={o}>{o === "All" ? "All types" : formatOrderType(o)}</option>)}
          </select>
          <select className="zc-select" value={payF} onChange={(e) => { setPayF(e.target.value); setPage(1); }} style={{ width: "auto" }}>
            {PAYMENT_STATUSES.map((o) => <option key={o} value={o}>{o === "All" ? "All payments" : formatPayment(o)}</option>)}
          </select>
          <input type="date" className="zc-input" value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }} style={{ width: "auto", color: startDate ? "var(--text-1)" : "var(--text-3)" }} />
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>to</span>
          <input type="date" className="zc-input" value={endDate} min={startDate || undefined}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }} style={{ width: "auto", color: endDate ? "var(--text-1)" : "var(--text-3)" }} />
          {(startDate || endDate) && (
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              {rangeStats.count} billed · <b className="tnum" style={{ color: "var(--accent-ink)" }}>₹{fmt(rangeStats.amount)}</b>
            </span>
          )}
          {hasFilters && (
            <button type="button" className="zc-btn sm" onClick={clearFilters}>Clear ✕</button>
          )}
        </div>
      )}

      {/* ── Floor: Table map + rail (Recent view, toggle on) ── */}
      {showTables && viewMode === "recent" && (
        <div className="op-floor">
          <div className="zc-card">
            <div className="zc-card-h">
              <span className="t">Table map</span>
              <span className="s">{tables.length} tables · {occupiedTables} seated</span>
            </div>
            <div style={{ padding: "14px 16px 16px" }}>
              {tablesLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(94px, 1fr))", gap: 10 }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="zc-skel" style={{ height: 100, borderRadius: 14 }} />
                  ))}
                </div>
              ) : tables.length === 0 ? (
                <div style={{ textAlign: "center", padding: 28, color: "var(--text-3)", fontSize: 13 }}>No tables configured yet</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(94px, 1fr))", gap: 10 }}>
                  {tables.slice().sort((a, b) => a.tableNo - b.tableNo).map((t) => {
                    const tOrders = tableOrderMap[t.tableNo] || [];
                    const occupied = tOrders.length > 0;
                    const isSel = tableSelected === t.tableNo;
                    const tTotal = tOrders.reduce((s, o) => s + Number(o.total || 0), 0);
                    const hasDue = tOrders.some((o) => o.paymentStatus === "PENDING_VERIFICATION");
                    let kind = null;
                    if (occupied) {
                      const counts = {};
                      tOrders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
                      const dom = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
                      kind = statusKind(dom);
                    }
                    const cls = !occupied ? " free" : isSel ? " sel" : hasDue ? " due" : "";
                    return (
                      <button
                        type="button"
                        key={t.tableNo}
                        className={`zc-tbl${cls}`}
                        onClick={() => setTableSelected(isSel ? null : t.tableNo)}
                      >
                        {occupied && (
                          <span className="dot" style={{ background: hasDue ? "var(--stop)" : KIND_HUE[kind], boxShadow: `0 0 8px ${hasDue ? "var(--stop)" : KIND_HUE[kind]}` }} />
                        )}
                        <div className="no">T{t.tableNo}</div>
                        <div className="st">{occupied ? `${tOrders.length} order${tOrders.length !== 1 ? "s" : ""}` : `${t.seats || 4} seats`}</div>
                        <div className="ft">
                          {occupied
                            ? <><span className="amt tnum">₹{Math.round(tTotal)}</span><span style={{ fontSize: 10, color: hasDue ? "var(--stop-ink)" : "var(--text-3)" }}>{hasDue ? "Due" : "Open"}</span></>
                            : <span style={{ fontSize: 11, color: "var(--text-3)" }}>Free</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="zc-rail" style={{ padding: 16, alignSelf: "start", position: "sticky", top: 8 }}>
            {tableSelected ? (
              <MultiOrderTableView
                orders={selectedTableOrders}
                tableNo={tableSelected}
                onStatusChange={(id, s) => { handleStatusChange(id, s); }}
                onPaymentChange={handlePaymentChange}
                onCombinedBill={(mode, value) => setShowCombinedBill({ mode, value })}
                onAddItems={(order) => setShowAddItems(order._id)}
                onNewOrder={openNewOrder}
              />
            ) : (
              <div className="zc-empty" style={{ padding: "44px 16px" }}>
                <div className="ic">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" />
                  </svg>
                </div>
                <h4>Pick a table</h4>
                <p>Tap a table to see its orders, split the bill, or start a new one.</p>
                <button type="button" className="zc-btn pri" style={{ marginTop: 16 }} onClick={() => openNewOrder()}>＋ New order</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Order list ── */}
      <div className="zc-card">
        <div className="zc-card-h">
          <span className="t">{viewMode === "recent" ? "Active orders" : "All orders"}</span>
          <span className="s">
            {loading ? "loading…" : error ? "unavailable" : `${displayedOrders.length} ${viewMode === "recent" ? "on the floor" : "matching"}`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "16px 18px" }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="zc-skel" />)}
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load orders"
            sub="The server did not respond. Check your connection, then try again."
            onRetry={fetchOrders}
          />
        ) : displayedOrders.length === 0 ? (
          <div className="zc-empty">
            <div className="ic">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" />
              </svg>
            </div>
            <h4>{viewMode === "recent" ? "Floor is clear" : "No orders match"}</h4>
            <p>{viewMode === "recent"
              ? "No active orders right now. Start one from New order."
              : "Nothing matches these filters. Try clearing them."}</p>
            <button type="button" className="zc-btn pri" style={{ marginTop: 16 }}
              onClick={() => (viewMode === "recent" ? openNewOrder() : clearFilters())}>
              {viewMode === "recent" ? "＋ New order" : "Clear filters"}
            </button>
          </div>
        ) : (
          <>
            {/* desktop / tablet ledger */}
            <div className="op-hide-narrow op-scroll" style={{ overflowX: "auto", padding: "6px 10px 8px" }}>
              <table className="zc-ledger" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ width: 108 }}>Order</th>
                    <th>Customer</th>
                    <th style={{ width: 92 }}>Table / Type</th>
                    <th>Items</th>
                    <th style={{ width: 148 }}>Status</th>
                    <th style={{ width: 130 }}>Payment</th>
                    <th className="num" style={{ width: 92 }}>Amount</th>
                    <th className="num" style={{ width: 78 }}>Placed</th>
                    <th style={{ width: 92 }} />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((o) => {
                    const name = o.guestName || o.user?.name || "Guest";
                    const phone = o.guestPhone || o.user?.phone || null;
                    return (
                      <tr key={o._id} onClick={() => setExpanded(o._id)} style={{ cursor: "pointer" }}>
                        <td className="idc tnum">{o.orderId}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span style={{ width: 27, height: 27, borderRadius: "50%", background: avc(name), color: "#fff", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700, flex: "none" }}>{ini(name)}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{name}</div>
                              {phone && <div style={{ fontSize: 11, color: "var(--text-3)" }}>+91 {phone}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          {o.tableNo
                            ? <span className="zc-tag vio sq">T{o.tableNo}</span>
                            : <span style={{ color: "var(--text-3)", fontSize: 12 }}>{formatOrderType(o.orderType)}</span>}
                        </td>
                        <td style={{ maxWidth: 190, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.items?.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}
                        </td>
                        <td><span className={`zc-tag ${statusKind(o.status)}`}><i />{formatStatus(o.status)}</span></td>
                        <td>
                          <span className={`zc-tag ${statusKind(o.paymentStatus)}`}><i />{formatPayment(o.paymentStatus)}</span>
                          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{o.paymentMethod || "Cash"}</div>
                        </td>
                        <td className="money">₹{Math.round(o.total)}</td>
                        <td className="num" style={{ color: "var(--text-3)" }}>
                          {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td>{rowActions(o)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <div className="op-only-narrow" style={{ padding: "10px 12px 4px" }}>
              {paginated.map((o) => {
                const name = o.guestName || o.user?.name || "Guest";
                return (
                  <div key={o._id} className="op-ocard" onClick={() => setExpanded(o._id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="tnum" style={{ fontWeight: 700, color: "var(--accent-ink)", fontSize: 12.5 }}>{o.orderId}</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-1)", marginTop: 2, fontWeight: 500 }}>{name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.items?.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flex: "none" }}>
                        <div className="tnum" style={{ fontWeight: 700, fontSize: 14, color: "var(--text-1)" }}>₹{Math.round(o.total)}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>
                          {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
                      {o.tableNo && <span className="zc-tag vio sq">T{o.tableNo}</span>}
                      <span className={`zc-tag ${statusKind(o.status)}`}><i />{formatStatus(o.status)}</span>
                      <span className={`zc-tag ${statusKind(o.paymentStatus)}`}><i />{formatPayment(o.paymentStatus)}</span>
                      <div style={{ marginLeft: "auto" }}>{rowActions(o)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="zc-tfoot" style={{ padding: "14px 18px 6px" }}>
                <span>
                  Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, displayedOrders.length)} of {displayedOrders.length}
                </span>
                <div className="zc-pager">
                  <button type="button" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                  {pageList.map((p, i) =>
                    p === "…"
                      ? <span key={`g${i}`} className="gap">…</span>
                      : <button type="button" key={p} className={page === p ? "on" : ""} onClick={() => setPage(p)}>{p}</button>,
                  )}
                  <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          onClose={() => setExpanded(null)}
          onStatusChange={(id, s) => handleStatusChange(id, s)}
          onPaymentChange={handlePaymentChange}
          onCombinedBill={(mode, value) => setShowCombinedBill({ mode, value })}
          onPrint={handlePrint}
          onAddItems={(o) => { setShowAddItems(o._id); setExpanded(null); }}
          onConfirm={handleConfirm}
          onReject={handleReject}
          actionBusy={actionBusy}
        />
      )}

      {showCreate && (
        <CreateOrderModal
          initialTableNo={presetTableNo}
          onClose={() => { setShowCreate(false); setPresetTableNo(null); }}
          onCreated={(o) => upsertOrder(o)}
        />
      )}

      {showAddItems && (
        <AddItemsToOrderModal
          order={orders.find((o) => o._id === showAddItems)}
          onClose={() => setShowAddItems(null)}
          onItemsAdded={(updatedOrder) =>
            setOrders((prev) => prev.map((o) => (o._id === updatedOrder._id ? updatedOrder : o)))
          }
        />
      )}

      {showCombinedBill && (
        <CombinedBillModal
          mode={showCombinedBill.mode}
          value={showCombinedBill.value}
          onClose={() => setShowCombinedBill(null)}
          onPaymentChange={fetchOrders}
        />
      )}

      {showPending && (
        <PendingOrdersModal
          orders={todayOrders.filter((o) => o.status === "PENDING_CONFIRMATION")}
          busy={actionBusy}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onClose={() => setShowPending(false)}
        />
      )}
    </div>
  );
}
