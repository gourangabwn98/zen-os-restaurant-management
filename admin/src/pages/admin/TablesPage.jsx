import { PRIMARY, PRIMARY_LIGHT, PRIMARY_DARK } from "../../theme.js";
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getAllOrders, updateOrderStatus, getAllInvoices, updateInvoiceStatus,
  getAllTables, createTable, updateTable, deleteTable, regenerateQR,
  getOpenTableSessions, clearTableSession,
} from "../../services/adminService.js";

// ── Dark tokens ───────────────────────────────────────────────────────────────
const PINK       = PRIMARY;
const PINK_LIGHT = "rgba(124,58,237,0.15)";
const PINK_DARK  = PRIMARY_DARK;
const GREEN      = "#10b981";
const GREEN_LIGHT= "rgba(16,185,129,0.15)";
const CARD       = "#16132a";
const CARD2      = "#1c1830";
const BG_FLOOR   = "#0f0d18";
const BORDER     = "rgba(255,255,255,0.07)";
const T1         = "#f1f0f5";
const T2         = "#9ca3af";
const T3         = "#4b5563";

const STATUS_STYLE = {
  Empty:    { bg:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.12)", tc:"#6b7280",  label:"Free"      },
  Placed:   { bg:"rgba(56,122,221,0.15)",  border:"#378ADD",               tc:"#60a5fa",  label:"Placed"    },
  Preparing:{ bg:"rgba(186,117,23,0.15)",  border:"#BA7517",               tc:"#fbbf24",  label:"Preparing" },
  Ready:    { bg:"rgba(16,185,129,0.15)",  border:"#10b981",               tc:"#34d399",  label:"Ready"     },
  Delivered:{ bg:"rgba(16,185,129,0.15)",  border:"#10b981",               tc:"#34d399",  label:"Delivered" },
  Completed:{ bg:"rgba(107,114,128,0.15)", border:"#4b5563",               tc:"#9ca3af",  label:"Completed" },
  Cancelled:{ bg:"rgba(239,68,68,0.15)",   border:"#ef4444",               tc:"#f87171",  label:"Cancelled" },
};

const ACTIVE_STATUSES = ["Placed","Preparing","Ready","Delivered"];
const ALL_STATUSES    = ["Placed","Preparing","Ready","Delivered","Completed","Cancelled"];

// ── Inject styles ─────────────────────────────────────────────────────────────
if (!document.getElementById("tables-page-styles")) {
  const s = document.createElement("style");
  s.id = "tables-page-styles";
  s.textContent = `
    @keyframes blinkBorder {
      0%,100%{ box-shadow:0 0 0 0 rgba(211,47,47,0); border-color:#d32f2f; }
      50%{ box-shadow:0 0 0 5px rgba(211,47,47,.25); border-color:#ff1744; }
    }
    @keyframes slideUp {
      from{ opacity:0; transform:translateY(18px); }
      to{ opacity:1; transform:translateY(0); }
    }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    @keyframes pulseGreen {
      0%,100%{ box-shadow:0 0 0 0 rgba(16,185,129,0); }
      50%{ box-shadow:0 0 0 5px rgba(16,185,129,.22); }
    }
    @keyframes spin { to{transform:rotate(360deg)} }
    .tables-root *{ box-sizing:border-box; font-family:'DM Sans',sans-serif; }
    .blink-pending{ animation:blinkBorder 1.4s ease-in-out infinite; }
    .pulse-live{ animation:pulseGreen 2s ease-in-out infinite; }
    .drawer-enter{ animation:slideUp .22s cubic-bezier(.4,0,.2,1) both; }
    .table-card-hover:hover{ transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.3); }
    .btn-ghost-dark{
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:5px 12px; font-size:11px; cursor:pointer;
      color:#9ca3af; transition:all .15s; font-family:'DM Sans',sans-serif;
    }
    .btn-ghost-dark:hover{ background:rgba(255,255,255,0.1); color:#f1f0f5; }
    .status-btn{
      padding:5px 13px; border-radius:20px; font-size:11.5px; font-weight:500;
      cursor:pointer; transition:all .15s; border:1.5px solid transparent;
      font-family:'DM Sans',sans-serif;
    }
    .status-btn:hover{ filter:brightness(1.15); transform:scale(1.03); }
    .status-btn:disabled{ opacity:.45; cursor:not-allowed; }
    .modal-overlay{
      position:fixed; inset:0; background:rgba(0,0,0,.75); z-index:1000;
      display:flex; align-items:center; justify-content:center;
      animation:fadeIn .18s ease both; backdrop-filter:blur(4px);
    }
    .modal-box{
      background:#13111f; border-radius:20px; padding:28px;
      box-shadow:0 24px 64px rgba(0,0,0,.6);
      animation:slideUp .22s cubic-bezier(.4,0,.2,1) both;
      border:1px solid rgba(139,92,246,0.2);
    }
    .input-dark{
      width:100%; padding:11px 14px; border-radius:10px;
      border:1px solid rgba(255,255,255,0.1); background:#1c1830;
      color:#f1f0f5; font-size:14px; outline:none; transition:border .15s;
      font-family:'DM Sans',sans-serif; box-sizing:border-box;
    }
    .input-dark:focus{ border-color:rgba(124,58,237,0.5); box-shadow:0 0 0 3px rgba(124,58,237,0.1); }
    .input-dark option{ background:#1c1830; }
    .tag{ display:inline-flex; align-items:center; gap:4px; padding:3px 10px;
      border-radius:20px; font-size:11px; font-weight:500; }
    .spinner{
      width:16px; height:16px; border:2px solid rgba(255,255,255,.2);
      border-top-color:#fff; border-radius:50%;
      animation:spin .7s linear infinite; display:inline-block;
    }
    .qr-btn{
      display:flex; align-items:center; justify-content:center; gap:6px;
      padding:9px 16px; border-radius:10px; font-size:12px; font-weight:500;
      cursor:pointer; transition:all .15s; border:1px solid;
      font-family:'DM Sans',sans-serif;
    }
    .qr-btn:hover{ filter:brightness(1.1); transform:translateY(-1px); }
    @media print {
      body > *:not(#qr-print-area){ display:none !important; }
      #qr-print-area{ display:block !important; }
    }
  `;
  document.head.appendChild(s);
}

// ── QRModal ───────────────────────────────────────────────────────────────────
function QRModal({ table, onClose, onRegenerate }) {
  const [regen, setRegen] = useState(false);
  const [qrData, setQrData] = useState({ code: table.qrCode, url: table.qrUrl });

  const handleRegenerate = async () => {
    try {
      setRegen(true);
      const { data } = await onRegenerate(table.tableNo);
      setQrData({ code: data.qrCode, url: data.qrUrl });
      toast.success("QR regenerated!");
    } catch { toast.error("Regenerate failed"); }
    finally { setRegen(false); }
  };

  const handleDownload = () => {
    if (!qrData.code) return;
    const a = document.createElement("a");
    a.href = qrData.code; a.download = `table-${table.tableNo}-qr.png`; a.click();
  };

  const handlePrint = () => {
    let el = document.getElementById("qr-print-area");
    if (!el) { el = document.createElement("div"); el.id = "qr-print-area"; document.body.appendChild(el); }
    el.style.display = "none";
    el.innerHTML = `<div style="text-align:center;padding:40px;font-family:sans-serif">
      <div style="font-size:22px;font-weight:800;color:${PINK};margin-bottom:20px">Table ${table.tableNo}</div>
      <img src="${qrData.code}" style="width:220px;height:220px;border:2px solid ${PINK};border-radius:12px;padding:8px"/>
      <div style="margin-top:16px;font-size:11px;color:#aaa">${qrData.url}</div>
    </div>`;
    window.print();
  };

  const handleCopyUrl = () => { if (!qrData.url) return; navigator.clipboard.writeText(qrData.url); toast.success("Link copied!"); };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width:420 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:17, color:T1 }}>QR Code — Table {table.tableNo}</div>
            <div style={{ fontSize:12, color:T2, marginTop:3 }}>{table.seats} seats · {table.status||"Active"}</div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%",
            border:`1px solid ${BORDER}`, background:CARD, cursor:"pointer",
            fontSize:14, color:T2, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        <div style={{ textAlign:"center", marginBottom:18 }}>
          {qrData.code ? (
            <div style={{ display:"inline-block", padding:14, borderRadius:16,
              border:`1px solid ${PINK}33`, background:CARD2 }}>
              <img src={qrData.code} alt={`QR Table ${table.tableNo}`}
                style={{ width:200, height:200, display:"block", borderRadius:8 }} />
            </div>
          ) : (
            <div style={{ width:200, height:200, margin:"0 auto", borderRadius:16,
              background:CARD2, border:`2px dashed ${BORDER}`,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:T3 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>⬛</div>
              <div style={{ fontSize:12 }}>No QR yet</div>
            </div>
          )}
          <div style={{ marginTop:12, fontSize:16, fontWeight:700, color:T1 }}>Table {table.tableNo}</div>
          <div style={{ fontSize:12, color:T2, marginTop:2 }}>Scan to order instantly</div>
        </div>

        {qrData.url && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18,
            padding:"10px 12px", background:CARD, borderRadius:10, border:`1px solid ${BORDER}` }}>
            <div style={{ flex:1, fontSize:11, color:T3, wordBreak:"break-all",
              fontFamily:"monospace", lineHeight:1.4 }}>{qrData.url}</div>
            <button onClick={handleCopyUrl} className="btn-ghost-dark" style={{ flexShrink:0 }}>Copy</button>
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          <button onClick={handleDownload} disabled={!qrData.code} className="qr-btn"
            style={{ background:PINK_LIGHT, color:"#c4b5fd", borderColor:`${PINK}44`, opacity:!qrData.code?.5:1 }}>
            ↓ Download PNG
          </button>
          <button onClick={handlePrint} disabled={!qrData.code} className="qr-btn"
            style={{ background:"rgba(59,130,246,0.15)", color:"#93c5fd", borderColor:"rgba(59,130,246,0.3)", opacity:!qrData.code?.5:1 }}>
            🖨 Print QR
          </button>
        </div>
        <button onClick={handleRegenerate} disabled={regen} className="qr-btn"
          style={{ width:"100%", background:CARD2, color:T2, borderColor:BORDER, opacity:regen?.6:1 }}>
          {regen ? <><span className="spinner" style={{ borderTopColor:T2 }} /> Regenerating…</> : "↻ Regenerate QR"}
        </button>
        <div style={{ marginTop:10, fontSize:11, color:T3, textAlign:"center" }}>
          Regenerating changes the QR image but keeps the same URL
        </div>
      </div>
    </div>
  );
}

// ── Chair ─────────────────────────────────────────────────────────────────────
const Chair = ({ pos, occupied }) => {
  const isH = pos==="top"||pos==="bottom";
  return (
    <div style={{
      background: occupied ? PINK_LIGHT : "rgba(255,255,255,0.06)",
      border: `1.5px solid ${occupied ? PINK : "rgba(255,255,255,0.15)"}`,
      flexShrink:0, transition:"all .2s",
      borderRadius: isH ? (pos==="top"?"5px 5px 0 0":"0 0 5px 5px") : (pos==="left"?"5px 0 0 5px":"0 5px 5px 0"),
      width: isH ? 20 : 11, height: isH ? 11 : 20,
    }} />
  );
};

// ── TableCard ─────────────────────────────────────────────────────────────────
const TableCard = ({ config, order, invoice, onClick, isSelected, tableStatus, onToggleStatus, onDelete, onQR }) => {
  const status = order ? order.status : "Empty";
  const s      = STATUS_STYLE[status] || STATUS_STYLE.Empty;
  const occ    = !!(order && ACTIVE_STATUSES.includes(status));
  const is4    = config.seats >= 4;
  const isPending = invoice?.invoiceStatus?.toLowerCase() === "pending";
  const isActive  = tableStatus === "Active";
  const w = is4 ? 78 : 64, h = is4 ? 64 : 52;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, position:"relative" }}>
      {/* Status pill */}
      <div style={{ fontSize:9, fontWeight:600, letterSpacing:0.5, textTransform:"uppercase",
        padding:"2px 8px", borderRadius:20, marginBottom:2,
        background: isActive ? GREEN_LIGHT : "rgba(107,114,128,0.15)",
        color: isActive ? GREEN : T3,
        border:`1px solid ${isActive ? "rgba(16,185,129,0.3)" : "rgba(107,114,128,0.3)"}`,
      }}>
        {isActive ? "Active" : "Inactive"}
      </div>

      {/* Top chairs */}
      <div style={{ display:"flex", gap:8 }}>
        <Chair pos="top" occupied={occ} />
        {is4 && <Chair pos="top" occupied={occ} />}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        {is4 && <Chair pos="left" occupied={occ} />}

        {/* Table body */}
        <div onClick={onClick} className={`table-card-hover ${isPending?"blink-pending":""}`}
          style={{
            width:w, height:h, borderRadius:12, cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            background: isPending ? "rgba(211,47,47,0.12)" : isSelected ? PINK_LIGHT : s.bg,
            border:`2px solid ${isSelected ? PINK : isPending ? "#d32f2f" : s.border}`,
            transform: isSelected ? "scale(1.07)" : "scale(1)",
            boxShadow: isSelected ? `0 0 0 4px ${PINK}22, 0 4px 16px rgba(124,58,237,.2)` : "0 2px 8px rgba(0,0,0,.2)",
            transition:"all .18s cubic-bezier(.4,0,.2,1)",
            opacity: isActive ? 1 : 0.45,
          }}>
          <div style={{ fontSize:11, fontWeight:700, color:isPending?"#f87171":isSelected?"#c4b5fd":s.tc,
            fontFamily:"'DM Mono',monospace", letterSpacing:0.5 }}>
            T{config.id}
          </div>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:0.5, textTransform:"uppercase",
            color:isPending?"#f87171":isSelected?PINK:s.tc, marginTop:1 }}>
            {isPending?"Pay Due":s.label}
          </div>
          {order && ACTIVE_STATUSES.includes(order.status) && (
            <div style={{ fontSize:11, fontWeight:700, color:isPending?"#f87171":PINK,
              marginTop:3, fontFamily:"'DM Mono',monospace" }}>
              ₹{Math.round(order.total).toLocaleString()}
            </div>
          )}
        </div>

        {is4 && <Chair pos="right" occupied={occ} />}
      </div>

      {/* Bottom chairs */}
      <div style={{ display:"flex", gap:8 }}>
        <Chair pos="bottom" occupied={occ} />
        {is4 && <Chair pos="bottom" occupied={occ} />}
      </div>

      {/* Action strip */}
      <div style={{ display:"flex", gap:4, marginTop:6, flexWrap:"wrap", justifyContent:"center" }}>
        <button onClick={e=>{ e.stopPropagation(); onQR(config.id); }}
          className="btn-ghost-dark"
          style={{ color:"#c4b5fd", borderColor:`${PINK}44`, background:PINK_LIGHT }}>
          QR
        </button>
        <button onClick={e=>{ e.stopPropagation(); onToggleStatus(config.id); }}
          className="btn-ghost-dark"
          style={{ color: isActive ? "#f87171" : GREEN,
            borderColor: isActive ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)" }}>
          {isActive ? "Off" : "On"}
        </button>
        <button onClick={e=>{ e.stopPropagation(); onDelete(config.id); }}
          className="btn-ghost-dark"
          style={{ color:"#f87171", borderColor:"rgba(239,68,68,0.3)" }}>
          ✕
        </button>
      </div>
    </div>
  );
};

// ── OrderDrawer ───────────────────────────────────────────────────────────────
const OrderDrawer = ({ config, order, invoice, session, onClose, onStatusChange, onInvoiceStatusChange, onClearTable }) => {
  const [updating,    setUpdating]    = useState(false);
  const [invUpdating, setInvUpdating] = useState(false);
  const [clearing,    setClearing]    = useState(false);
  const s         = order ? STATUS_STYLE[order.status]||STATUS_STYLE.Empty : STATUS_STYLE.Empty;
  const subtotal  = order?.items?.reduce((sum,i)=>sum+i.price*i.qty,0)||0;
  const isPending = invoice?.invoiceStatus?.toLowerCase()==="pending";

  const handleStatus = async (val) => {
    if (!val||!order) return;
    try { setUpdating(true); await onStatusChange(order._id, val); }
    finally { setUpdating(false); }
  };

  const handleInvStatus = async (ns) => {
    if (!invoice?._id) return;
    if (!window.confirm(`Mark invoice as "${ns}"?`)) return;
    try { setInvUpdating(true); await onInvoiceStatusChange(invoice._id, ns); }
    finally { setInvUpdating(false); }
  };

  const handleClear = async () => {
    try { setClearing(true); await onClearTable(session); }
    finally { setClearing(false); }
  };

  return (
    <div className="drawer-enter" style={{
      background: CARD, border:`1px solid ${isPending?"rgba(239,68,68,0.3)":BORDER}`,
      borderRadius:16, padding:24, marginTop:20,
      boxShadow: isPending ? "0 4px 32px rgba(211,47,47,.15)" : "0 4px 24px rgba(0,0,0,.2)",
    }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:16, display:"flex", alignItems:"center", gap:10, color:T1 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", color:PINK }}>T{config.id}</span>
            <span style={{ fontSize:13, color:T2, fontWeight:400 }}>· {config.seats} seats</span>
            {isPending && (
              <span className="tag" style={{ background:"rgba(239,68,68,0.15)", color:"#f87171",
                border:"1px solid rgba(239,68,68,0.3)" }}>⚠ Invoice Pending</span>
            )}
          </div>
          {order && (
            <div style={{ fontSize:12, color:T2, marginTop:5, fontFamily:"'DM Mono',monospace" }}>
              {order.orderId}
              {order.user?.name && <span style={{ fontFamily:"'DM Sans',sans-serif", marginLeft:8, color:T3 }}>· {order.user.name}</span>}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%",
          border:`1px solid ${BORDER}`, background:CARD2, cursor:"pointer",
          fontSize:14, color:T2, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>

      {session && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"10px 14px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.25)",
          borderRadius:10, marginBottom:18, fontSize:12.5 }}>
          <span style={{ color:"#34d399" }}>
            🟢 Occupied since {new Date(session.openedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
          </span>
          <button onClick={handleClear} disabled={clearing} style={{
            padding:"6px 14px", borderRadius:8, border:"none", background:"#16a34a",
            color:"#fff", fontWeight:700, fontSize:11.5, cursor:clearing?"not-allowed":"pointer",
            opacity:clearing?0.6:1,
          }}>
            {clearing ? "Clearing…" : "🧹 Clear Table"}
          </button>
        </div>
      )}

      {!order ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:T3 }}>
          <div style={{ fontSize:48, marginBottom:10 }}>○</div>
          <div style={{ fontSize:14, color:T2 }}>Table is free</div>
          <div style={{ fontSize:12, marginTop:4, color:T3 }}>{config.seats} seats available</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
          {/* LEFT — items */}
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:12 }}>Order Items</div>
            {order.items?.map((item,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${BORDER}`, fontSize:13 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:26, height:26, borderRadius:8, background:PINK_LIGHT,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:12, fontWeight:700, color:PINK, fontFamily:"'DM Mono',monospace" }}>
                    {item.qty}
                  </div>
                  <span style={{ color:T1 }}>{item.name}</span>
                </div>
                <span style={{ fontWeight:500, color:T1, fontFamily:"'DM Mono',monospace" }}>
                  ₹{(item.price*item.qty).toLocaleString()}
                </span>
              </div>
            ))}
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${BORDER}` }}>
              {[
                { l:"Subtotal", v:`₹${subtotal.toLocaleString()}` },
                ...(order.serviceCharge>0 ? [{ l:"Service Charge", v:`₹${order.serviceCharge}` }] : []),
                ...(order.tax>0           ? [{ l:"GST",            v:`₹${order.tax}`           }] : []),
              ].map(r => (
                <div key={r.l} style={{ display:"flex", justifyContent:"space-between",
                  fontSize:12, color:T2, marginBottom:6 }}>
                  <span>{r.l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace" }}>{r.v}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:16, marginTop:10 }}>
                <span style={{ color:T1 }}>Total</span>
                <span style={{ color:isPending?"#f87171":PINK, fontFamily:"'DM Mono',monospace" }}>
                  ₹{Math.round(order.total).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT — status + invoice */}
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:10 }}>Current Status</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
              <span className="tag" style={{ background:s.bg, color:s.tc, border:`1.5px solid ${s.border}` }}>
                {order.status}
              </span>
              <span className="tag" style={{ background:"rgba(139,92,246,0.15)", color:"#c4b5fd",
                border:"1px solid rgba(139,92,246,0.3)" }}>Dining</span>
              <span className="tag" style={{
                background: order.paymentStatus==="Paid" ? GREEN_LIGHT : "rgba(245,158,11,0.15)",
                color: order.paymentStatus==="Paid" ? "#34d399" : "#fbbf24",
                border:`1px solid ${order.paymentStatus==="Paid" ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
              }}>{order.paymentStatus}</span>
            </div>

            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:10 }}>Update Order</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:22 }}>
              {ALL_STATUSES.filter(st=>st!==order.status).map(st => {
                const stl = STATUS_STYLE[st]||{ bg:"rgba(107,114,128,0.15)", border:"#4b5563", tc:"#9ca3af" };
                return (
                  <button key={st} className="status-btn" onClick={()=>handleStatus(st)}
                    disabled={updating}
                    style={{ background:stl.bg, borderColor:stl.border, color:stl.tc }}>
                    {updating ? <span className="spinner" /> : st}
                  </button>
                );
              })}
            </div>

            {invoice ? (
              <>
                <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
                  textTransform:"uppercase", marginBottom:10 }}>Invoice</div>
                <div style={{
                  background: isPending ? "rgba(239,68,68,0.08)" : GREEN_LIGHT,
                  border:`1px solid ${isPending ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
                  borderRadius:12, padding:14, marginBottom:12,
                }}>
                  {[
                    { l:"Invoice ID", v:`…${invoice._id?.slice(-8)}`, mono:true },
                    { l:"Amount",    v:`₹${Math.round(invoice.total||order.total).toLocaleString()}`, mono:true },
                  ].map(r => (
                    <div key={r.l} style={{ display:"flex", justifyContent:"space-between",
                      fontSize:12, marginBottom:8 }}>
                      <span style={{ color:T2 }}>{r.l}</span>
                      <span style={{ fontWeight:500, color:T1, fontFamily:r.mono?"'DM Mono',monospace":undefined }}>{r.v}</span>
                    </div>
                  ))}
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, alignItems:"center" }}>
                    <span style={{ color:T2 }}>Status</span>
                    <span className="tag" style={{
                      background: isPending ? "rgba(239,68,68,0.15)" : GREEN_LIGHT,
                      color: isPending ? "#f87171" : "#34d399",
                      border:`1px solid ${isPending ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
                      textTransform:"capitalize",
                    }}>{invoice.invoiceStatus}</span>
                  </div>
                </div>
                {isPending && (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>handleInvStatus("completed")} disabled={invUpdating}
                      style={{ flex:1, padding:11, background:"rgba(16,185,129,0.2)", color:"#34d399",
                        border:"1px solid rgba(16,185,129,0.3)", borderRadius:10, fontWeight:700,
                        cursor:"pointer", fontSize:13, opacity:invUpdating?.5:1 }}>
                      {invUpdating ? <span className="spinner" /> : "✓ Mark Paid"}
                    </button>
                    <button onClick={()=>handleInvStatus("cancelled")} disabled={invUpdating}
                      style={{ flex:1, padding:11, background:"rgba(239,68,68,0.15)", color:"#f87171",
                        border:"1px solid rgba(239,68,68,0.3)", borderRadius:10, fontWeight:700,
                        cursor:"pointer", fontSize:13, opacity:invUpdating?.5:1 }}>
                      {invUpdating ? <span className="spinner" /> : "✕ Cancel"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ background:CARD2, borderRadius:10, padding:14, fontSize:12,
                color:T3, textAlign:"center", border:`1px dashed ${BORDER}` }}>
                No invoice generated yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── StatCard ──────────────────────────────────────────────────────────────────
const StatCard = ({ label, val, color }) => (
  <div style={{ background:CARD, borderRadius:12, padding:"14px 18px",
    border:`1px solid ${BORDER}`, boxShadow:"0 2px 8px rgba(0,0,0,.2)" }}>
    <div style={{ fontSize:22, fontWeight:700, color:color||T1, fontFamily:"'DM Mono',monospace" }}>{val}</div>
    <div style={{ fontSize:11, color:T3, marginTop:3, fontWeight:500, letterSpacing:0.3 }}>{label}</div>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TablesPage() {
  const [tables,     setTables]     = useState([]);
  const [tableMap,   setTableMap]   = useState({});
  const [invoiceMap, setInvoiceMap] = useState({});
  const [sessionMap, setSessionMap] = useState({});
  const [selected,   setSelected]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [showModal,  setShowModal]  = useState(false);
  const [newTableNo, setNewTableNo] = useState("");
  const [newSeats,   setNewSeats]   = useState("4");
  const [creating,   setCreating]   = useState(false);
  const [qrTable,    setQrTable]    = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [ordersRes, invoicesRes, tablesRes, sessionsRes] = await Promise.all([
        getAllOrders({ limit:100 }),
        getAllInvoices().catch(()=>({ data:{ invoices:[] } })),
        getAllTables().catch(()=>({ data:{ tables:[] } })),
        getOpenTableSessions().catch(()=>({ data:{ sessions:[] } })),
      ]);
      const orders   = ordersRes?.data?.orders||[];
      const invoices = invoicesRes?.data?.invoices||[];
      const dbTables = tablesRes?.data?.tables||[];
      const sessions = sessionsRes?.data?.sessions||[];

      // NOTE: orderType/status moved to DINE_IN / the new canonical status
      // enum in Phase 1 — this must match those, not the old "Dining" /
      // "Completed" strings, or every table would always show as free.
      const NON_TERMINAL = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
      const oMap = {};
      orders.filter(o=>o.orderType==="DINE_IN"&&o.tableNo&&NON_TERMINAL.includes(o.status))
        .forEach(o=>{ oMap[Number(o.tableNo)] = o; });

      const iMap = {};
      invoices.forEach(inv => {
        const ids = inv.orders?.map(String)||[];
        for (const [tableNo, ord] of Object.entries(oMap)) {
          if (ids.includes(String(ord._id))) {
            iMap[Number(tableNo)] = { ...inv, invoiceStatus:inv.status||inv.paymentStatus||"pending" };
            break;
          }
        }
      });

      const sMap = {};
      sessions.forEach(s => { sMap[Number(s.tableNo)] = s; });

      setTables(dbTables); setTableMap(oMap); setInvoiceMap(iMap); setSessionMap(sMap);
    } catch { setError("Failed to load table data"); toast.error("Could not load tables"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const iv=setInterval(fetchData,30000); return()=>clearInterval(iv); }, [fetchData]);

  const handleStatusChange  = async (id, ns) => { try { await updateOrderStatus(id,ns); toast.success(`→ ${ns}`); await fetchData(); setSelected(null); } catch { toast.error("Update failed"); } };
  const handleInvChange     = async (id, ns) => { try { await updateInvoiceStatus(id,ns); toast.success(`Invoice → ${ns}`); await fetchData(); } catch { toast.error("Invoice update failed"); } };
  const handleToggleStatus  = async (tableNo) => { const t=tables.find(t=>t.tableNo===tableNo); if(!t)return; const ns=t.status==="Active"?"Inactive":"Active"; try { await updateTable(tableNo,{status:ns}); toast.success(`Table ${tableNo} → ${ns}`); fetchData(); } catch { toast.error("Failed to update"); } };
  const handleDelete        = async (tableNo) => { if(!window.confirm(`Delete Table ${tableNo}?`))return; try { await deleteTable(tableNo); toast.success(`Table ${tableNo} deleted`); fetchData(); if(selected===tableNo)setSelected(null); } catch(e){ toast.error(e.response?.data?.message||"Failed"); } };
  const handleRegenerate    = async (tableNo) => { const { data }=await regenerateQR(tableNo); setTables(p=>p.map(t=>t.tableNo===tableNo?{...t,qrCode:data.qrCode,qrUrl:data.qrUrl}:t)); return { data }; };
  const handleClearTable    = async (session) => {
    if (!session?._id) return;
    if (!window.confirm(`Clear Table ${session.tableNo}? This closes the table's session.`)) return;
    try {
      await clearTableSession(session._id);
      toast.success(`Table ${session.tableNo} cleared`);
      await fetchData();
      setSelected(null);
    } catch (e) {
      toast.error(e.response?.data?.message || "Cannot clear table — it may still have active orders");
    }
  };

  const handleCreate = async () => {
    if (!newTableNo) return toast.error("Table number required");
    setCreating(true);
    try {
      await createTable({ tableNo:parseInt(newTableNo), seats:parseInt(newSeats) });
      toast.success(`Table ${newTableNo} created!`);
      setShowModal(false); setNewTableNo("");
      await fetchData();
      const res = await getAllTables();
      const created = (res.data?.tables||[]).find(t=>t.tableNo===parseInt(newTableNo));
      if (created) setQrTable(created);
    } catch(e) { toast.error(e.response?.data?.message||"Failed to create"); }
    finally { setCreating(false); }
  };

  const activeTables  = tables.filter(t=>t.status==="Active"||!t.status);
  const occupied      = activeTables.filter(t=>tableMap[t.tableNo]).length;
  const revenue       = Object.values(tableMap).reduce((s,o)=>s+Number(o.total||0),0);
  const pendingCount  = Object.values(invoiceMap).filter(i=>i.invoiceStatus?.toLowerCase()==="pending").length;
  const selectedConf  = selected ? tables.find(t=>t.tableNo===selected) : null;
  const selectedOrder = selected ? tableMap[selected]||null : null;
  const selectedInv   = selected ? invoiceMap[selected]||null : null;
  const selectedSession = selected ? sessionMap[selected]||null : null;

  if (loading) return (
    <div className="tables-root" style={{ textAlign:"center", padding:100, color:T3 }}>
      <div className="spinner" style={{ width:32, height:32, borderWidth:3,
        borderColor:"rgba(124,58,237,.2)", borderTopColor:PINK, margin:"0 auto 16px" }} />
      <div style={{ fontSize:14 }}>Loading floor plan…</div>
    </div>
  );
  if (error) return (
    <div className="tables-root" style={{ textAlign:"center", padding:80, color:"#f87171" }}>
      <div style={{ fontSize:16, marginBottom:14 }}>{error}</div>
      <button onClick={fetchData} style={{ padding:"10px 28px", background:PINK, color:"#fff",
        border:"none", borderRadius:25, fontWeight:600, cursor:"pointer" }}>Retry</button>
    </div>
  );

  return (
    <div className="tables-root" style={{ padding:28 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>Table Management</h1>
          <div style={{ fontSize:13, color:T2, marginTop:4, display:"flex", alignItems:"center", gap:10 }}>
            <span>Dining Floor</span>
            <span style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span className="pulse-live" style={{ width:7, height:7, borderRadius:"50%",
                background:GREEN, display:"inline-block" }} />
              <span style={{ color:GREEN, fontWeight:500 }}>Live</span>
              <span style={{ color:T3 }}>· every 30s</span>
            </span>
            {pendingCount>0 && (
              <span className="tag blink-pending" style={{ background:"rgba(239,68,68,0.15)",
                color:"#f87171", border:"1px solid rgba(239,68,68,0.3)", fontSize:11 }}>
                {pendingCount} invoice{pendingCount>1?"s":""} pending
              </span>
            )}
          </div>
        </div>
        <button onClick={()=>setShowModal(true)} style={{
          padding:"11px 22px", background:`linear-gradient(135deg,${PINK},#5b21b6)`,
          color:"#fff", border:"none", borderRadius:25, fontWeight:700,
          cursor:"pointer", fontSize:13, boxShadow:`0 4px 16px ${PINK}44`,
        }}>+ New Table</button>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:22 }}>
        <StatCard label="Occupied"         val={occupied}                                        color={PINK}    />
        <StatCard label="Free"             val={activeTables.length-occupied}                    color={GREEN}   />
        <StatCard label="Active Revenue"   val={`₹${Math.round(revenue).toLocaleString()}`}                     />
        <StatCard label="Total Tables"     val={tables.length}                                                   />
        <StatCard label="Pending Invoices" val={pendingCount} color={pendingCount>0?"#f87171":GREEN}             />
      </div>

      {/* Legend */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:16,
        padding:"10px 16px", background:CARD, borderRadius:10, border:`1px solid ${BORDER}` }}>
        {[
          { label:"Free",             bg:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.15)" },
          { label:"Placed",           bg:"rgba(56,122,221,0.15)",  border:"#378ADD" },
          { label:"Preparing",        bg:"rgba(186,117,23,0.15)",  border:"#BA7517" },
          { label:"Ready",            bg:GREEN_LIGHT,              border:GREEN },
          { label:"Invoice pending",  bg:"rgba(211,47,47,0.12)",   border:"#d32f2f", blink:true },
          { label:"Occupied chair",   bg:PINK_LIGHT,               border:PINK },
        ].map(l => (
          <div key={l.label} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T2 }}>
            <div className={l.blink?"blink-pending":""} style={{ width:10, height:10, borderRadius:3,
              background:l.bg, border:`1.5px solid ${l.border}` }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Floor plan */}
      <div style={{ background:BG_FLOOR, borderRadius:18, padding:32,
        border:`1px solid ${BORDER}`, boxShadow:"0 4px 24px rgba(0,0,0,.3)" }}>
        <div style={{ height:6, background:"rgba(139,92,246,0.4)", borderRadius:"4px 4px 0 0" }} />
        <div style={{ display:"flex", gap:10, justifyContent:"center", padding:"12px 0 16px",
          borderBottom:`1px dashed ${BORDER}` }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width:44, height:20, borderRadius:3,
              background:"rgba(139,92,246,0.1)", border:`1px solid ${BORDER}`,
              ...(i===1?{marginRight:18}:{}) }} />
          ))}
        </div>
        <div style={{ fontSize:10, color:T3, letterSpacing:2, textTransform:"uppercase",
          textAlign:"center", padding:"10px 0 20px" }}>Window side</div>

        {tables.length===0 ? (
          <div style={{ textAlign:"center", padding:"48px 20px", color:T3 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🪑</div>
            <div style={{ fontSize:14, color:T2 }}>No tables yet</div>
            <button onClick={()=>setShowModal(true)} style={{ marginTop:12, padding:"10px 24px",
              background:`linear-gradient(135deg,${PINK},#5b21b6)`, color:"#fff",
              border:"none", borderRadius:25, fontWeight:600, cursor:"pointer" }}>
              + Add First Table
            </button>
          </div>
        ) : (
          <div style={{ display:"flex", flexWrap:"wrap", gap:40, justifyContent:"center", paddingBottom:28 }}>
            {tables.sort((a,b)=>a.tableNo-b.tableNo).map(t => (
              <TableCard key={t.tableNo}
                config={{ id:t.tableNo, seats:t.seats }}
                order={tableMap[t.tableNo]||null}
                invoice={invoiceMap[t.tableNo]||null}
                onClick={()=>setSelected(selected===t.tableNo?null:t.tableNo)}
                isSelected={selected===t.tableNo}
                tableStatus={t.status||"Active"}
                onToggleStatus={handleToggleStatus}
                onDelete={handleDelete}
                onQR={()=>setQrTable(t)}
              />
            ))}
          </div>
        )}

        <div style={{ width:"100%", height:1, margin:"0 0 18px",
          background:`repeating-linear-gradient(90deg,${BORDER} 0,${BORDER} 8px,transparent 8px,transparent 16px)` }} />
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:10, color:T3, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>
            Counter &amp; Entrance
          </div>
          <div style={{ width:40, height:6, background:"rgba(139,92,246,0.4)", borderRadius:3, margin:"0 auto" }} />
        </div>
      </div>

      {/* Order Drawer */}
      {selected && selectedConf && (
        <OrderDrawer
          config={{ id:selectedConf.tableNo, seats:selectedConf.seats }}
          order={selectedOrder} invoice={selectedInv} session={selectedSession}
          onClose={()=>setSelected(null)}
          onStatusChange={handleStatusChange}
          onInvoiceStatusChange={handleInvChange}
          onClearTable={handleClearTable}
        />
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal-box" style={{ width:380 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, color:T1, marginBottom:4 }}>Add New Table</div>
            <div style={{ fontSize:13, color:T2, marginBottom:22 }}>A QR code will be generated automatically.</div>

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>Table Number</label>
            <input type="number" placeholder="e.g. 9" value={newTableNo}
              onChange={e=>setNewTableNo(e.target.value)}
              className="input-dark" style={{ marginBottom:14 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>Seating Capacity</label>
            <select value={newSeats} onChange={e=>setNewSeats(e.target.value)}
              className="input-dark" style={{ marginBottom:20 }}>
              <option value="2">2 Seats</option>
              <option value="4">4 Seats</option>
              <option value="6">6 Seats</option>
            </select>

            <div style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"10px 14px",
              background:PINK_LIGHT, borderRadius:10, marginBottom:20, border:`1px solid ${PINK}22` }}>
              <span style={{ fontSize:20 }}>⬛</span>
              <div style={{ fontSize:12, color:"#c4b5fd", lineHeight:1.5 }}>
                A unique QR code for <strong>Table {newTableNo||"?"}</strong> will be auto-generated.
              </div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowModal(false)} className="btn-ghost-dark"
                style={{ flex:1, padding:12, borderRadius:10, justifyContent:"center", display:"flex" }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating} style={{
                flex:1, padding:12, borderRadius:10,
                background: creating ? "#374151" : `linear-gradient(135deg,${PINK},#5b21b6)`,
                color:"#fff", border:"none", fontWeight:700, cursor:"pointer", fontSize:14,
                opacity:creating?.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                {creating ? <><span className="spinner" />Creating…</> : "Create + QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {qrTable && <QRModal table={qrTable} onClose={()=>setQrTable(null)} onRegenerate={handleRegenerate} />}
    </div>
  );
}