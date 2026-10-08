import { PRIMARY, PRIMARY_LIGHT, PRIMARY_DARK } from "../../theme.js";
import { canPickStatus, isBillSettled, offersStatus, needsPaidFirst, PAID_FIRST_HINT } from "./shared/paymentRules.js";
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getAllOrders, updateOrderStatus,
  getAllTables, createTable, updateTable, deleteTable, regenerateQR, getTakeawayQR,
  getOpenTableSessions, clearTableSession,
  getWaitlist, addWaitlistEntry, seatWaitlistEntry, cancelWaitlistEntry,
} from "../../services/adminService.js";
import { getSocket } from "../../services/socketService.js";
import { useVisibleInterval } from "../../hooks/useVisibleInterval.js";
import { t, tn, N_, fmtNum, fmtTime, localName } from "../../i18n/core.js";
import { customerName } from "./shared/customerName.js";
import { takenByName, takenByIsAcceptor } from "./shared/takenBy.js";
import { TABLE_AREAS, TABLE_AREA_LABEL, groupTablesByArea, tableLabel, tableLabelByNo } from "./shared/diningArea.js";

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

// Keys MUST match the canonical order-status enum (see
// restaurant-server/utils/orderStateMachine.js) — this file previously kept
// its own legacy "Placed"/"Preparing"/… keys from before the status rename,
// which meant every real order status (PENDING_CONFIRMATION, CONFIRMED, …)
// missed this lookup entirely and silently fell back to the "Empty"/Free
// style, so a table with a brand-new order looked free on the floor plan.
const STATUS_STYLE = {
  Empty:                { bg:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.12)", tc:"#6b7280",  label:N_("Free")      },
  PENDING_CONFIRMATION: { bg:"rgba(56,122,221,0.15)",  border:"#378ADD",               tc:"#60a5fa",  label:N_("Awaiting confirmation") },
  CONFIRMED:            { bg:"rgba(56,122,221,0.15)",  border:"#378ADD",               tc:"#60a5fa",  label:N_("Placed")    },
  PREPARING:            { bg:"rgba(186,117,23,0.15)",  border:"#BA7517",               tc:"#fbbf24",  label:N_("Cooking") },
  READY:                { bg:"rgba(16,185,129,0.15)",  border:"#10b981",               tc:"#34d399",  label:N_("Ready to Deliver") },
  DELIVERED:            { bg:"rgba(16,185,129,0.15)",  border:"#10b981",               tc:"#34d399",  label:N_("Served") },
  COMPLETED:            { bg:"rgba(107,114,128,0.15)", border:"#4b5563",               tc:"#9ca3af",  label:N_("Completed") },
  CANCELLED:            { bg:"rgba(239,68,68,0.15)",   border:"#ef4444",               tc:"#f87171",  label:N_("Cancelled") },
};

// Non-terminal statuses — a table with an order in any of these is occupied.
const ACTIVE_STATUSES = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
// Targets offered on the "Update Order" buttons. PENDING_CONFIRMATION is
// deliberately excluded — it's only ever an order's starting point, never
// something to switch back to (see CLAUDE.md). COMPLETED (clears the table)
// is offered for a cooking/ready/served order and locked until it is PAID.
const ALL_STATUSES    = ["CONFIRMED","PREPARING","READY","DELIVERED","COMPLETED","CANCELLED"].filter(canPickStatus);
// TBL-02: any table size the restaurant actually has (server allows 1–100).
const MIN_SEATS = 1, MAX_SEATS = 100;
const seatsError = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS ? null : t("Seats must be a whole number from {a} to {b}", { a: MIN_SEATS, b: MAX_SEATS });
};

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
// `table.takeaway` = the shared counter QR (no table, no regenerate — its URL
// carries no token, so there's nothing to rotate).
function QRModal({ table, onClose, onRegenerate }) {
  const isTakeaway = !!table.takeaway;
  const name = isTakeaway ? t("Takeaway") : tableLabel(table);
  const [regen, setRegen] = useState(false);
  const [qrData, setQrData] = useState({ code: table.qrCode, url: table.qrUrl });
  const [stale, setStale] = useState(!!table.qrStale);

  // keepToken: fix the link only (same table token); otherwise a brand-new
  // token — every QR already printed for this table stops working.
  const handleRegenerate = async (keepToken = false) => {
    if (!keepToken && !window.confirm(t("Make a new QR for {name}? QR codes already printed for this table will stop working.", { name }))) return;
    try {
      setRegen(true);
      const { data } = await onRegenerate(table.tableNo, keepToken ? { keepToken: true } : {});
      setQrData({ code: data.qrCode, url: data.qrUrl });
      setStale(false);
      toast.success(keepToken ? t("QR link fixed — print the new QR") : t("New QR created — print it"));
    } catch (e) { toast.error(e?.response?.data?.message || t("Regenerate failed")); }
    finally { setRegen(false); }
  };

  const handleDownload = () => {
    if (!qrData.code) return;
    const a = document.createElement("a");
    a.href = qrData.code; a.download = isTakeaway ? "takeaway-qr.png" : `table-${table.tableNo}-qr.png`; a.click();
  };

  const handlePrint = () => {
    let el = document.getElementById("qr-print-area");
    if (!el) { el = document.createElement("div"); el.id = "qr-print-area"; document.body.appendChild(el); }
    el.style.display = "none";
    el.innerHTML = `<div style="text-align:center;padding:40px;font-family:sans-serif">
      <div style="font-size:22px;font-weight:800;color:${PINK};margin-bottom:20px">${name}</div>
      <img src="${qrData.code}" style="width:220px;height:220px;border:2px solid ${PINK};border-radius:12px;padding:8px"/>
      <div style="margin-top:16px;font-size:11px;color:#aaa">${qrData.url}</div>
    </div>`;
    window.print();
  };

  const handleCopyUrl = () => { if (!qrData.url) return; navigator.clipboard.writeText(qrData.url); toast.success(t("Link copied!")); };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width:420 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:17, color:T1 }}>{t("QR Code — {name}", { name })}</div>
            <div style={{ fontSize:12, color:T2, marginTop:3 }}>
              {isTakeaway ? t("Place at the counter / entrance") : `${t("{n} seats", { n: table.seats })} · ${t(table.status||"Active")}`}
            </div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%",
            border:`1px solid ${BORDER}`, background:CARD, cursor:"pointer",
            fontSize:14, color:T2, display:"flex", alignItems:"center", justifyContent:"center" }} aria-label={t("Close")}>✕</button>
        </div>

        <div style={{ textAlign:"center", marginBottom:18 }}>
          {qrData.code ? (
            <div style={{ display:"inline-block", padding:14, borderRadius:16,
              border:`1px solid ${PINK}33`, background:CARD2 }}>
              <img src={qrData.code} alt={t("QR {name}", { name })}
                style={{ width:200, height:200, display:"block", borderRadius:8 }} />
            </div>
          ) : (
            <div style={{ width:200, height:200, margin:"0 auto", borderRadius:16,
              background:CARD2, border:`2px dashed ${BORDER}`,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:T3 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>⬛</div>
              <div style={{ fontSize:12 }}>{t("No QR yet")}</div>
            </div>
          )}
          <div style={{ marginTop:12, fontSize:16, fontWeight:700, color:T1 }}>{name}</div>
          <div style={{ fontSize:12, color:T2, marginTop:2 }}>
            {isTakeaway ? t("Scan to order takeaway") : t("Scan to order instantly")}
          </div>
        </div>

        {!isTakeaway && stale && (
          <div role="alert" style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14, padding:"10px 12px",
            borderRadius:10, background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.35)" }}>
            <div style={{ flex:1, fontSize:12, color:"#fbbf24", lineHeight:1.45 }}>
              ⚠ {t("This QR points to an old or wrong link — guests who scan it won't reach the menu.")}
            </div>
            <button onClick={()=>handleRegenerate(true)} disabled={regen} className="qr-btn"
              style={{ flexShrink:0, background:"rgba(245,158,11,0.18)", color:"#fbbf24", borderColor:"rgba(245,158,11,0.4)" }}>
              {t("Fix link")}
            </button>
          </div>
        )}

        {qrData.url && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18,
            padding:"10px 12px", background:CARD, borderRadius:10, border:`1px solid ${BORDER}` }}>
            <div style={{ flex:1, fontSize:11, color:T3, wordBreak:"break-all",
              fontFamily:"monospace", lineHeight:1.4 }}>{qrData.url}</div>
            <button onClick={handleCopyUrl} className="btn-ghost-dark" style={{ flexShrink:0 }}>{t("Copy")}</button>
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          <button onClick={handleDownload} disabled={!qrData.code} className="qr-btn"
            style={{ background:PINK_LIGHT, color:"#c4b5fd", borderColor:`${PINK}44`, opacity:!qrData.code?.5:1 }}>
            ↓ {t("Download PNG")}
          </button>
          <button onClick={handlePrint} disabled={!qrData.code} className="qr-btn"
            style={{ background:"rgba(59,130,246,0.15)", color:"#93c5fd", borderColor:"rgba(59,130,246,0.3)", opacity:!qrData.code?.5:1 }}>
            🖨 {t("Print QR")}
          </button>
        </div>
        {!isTakeaway && <>
          <button onClick={()=>handleRegenerate(false)} disabled={regen} className="qr-btn"
            style={{ width:"100%", background:CARD2, color:T2, borderColor:BORDER, opacity:regen?.6:1 }}>
            {regen ? <><span className="spinner" style={{ borderTopColor:T2 }} /> {t("Regenerating…")}</> : `↻ ${t("Regenerate QR")}`}
          </button>
          <div style={{ marginTop:10, fontSize:11, color:T3, textAlign:"center" }}>
            {t("A new QR replaces the old one — QR codes already printed for this table stop working.")}
          </div>
        </>}
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
const TableCard = ({ config, order, onClick, isSelected, tableStatus, onToggleStatus, onDelete, onQR, qrStale, area = "", onAreaChange }) => {
  const status = order ? order.status : "Empty";
  const s      = STATUS_STYLE[status] || STATUS_STYLE.Empty;
  const occ    = !!(order && ACTIVE_STATUSES.includes(status));
  const is4    = config.seats >= 4;
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
        {isActive ? t("Active") : t("Inactive")}
      </div>

      {/* Top chairs */}
      <div style={{ display:"flex", gap:8 }}>
        <Chair pos="top" occupied={occ} />
        {is4 && <Chair pos="top" occupied={occ} />}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        {is4 && <Chair pos="left" occupied={occ} />}

        {/* Table body */}
        <div onClick={onClick} className="table-card-hover"
          style={{
            width:w, height:h, borderRadius:12, cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            background: isSelected ? PINK_LIGHT : s.bg,
            border:`2px solid ${isSelected ? PINK : s.border}`,
            transform: isSelected ? "scale(1.07)" : "scale(1)",
            boxShadow: isSelected ? `0 0 0 4px ${PINK}22, 0 4px 16px rgba(124,58,237,.2)` : "0 2px 8px rgba(0,0,0,.2)",
            transition:"all .18s cubic-bezier(.4,0,.2,1)",
            opacity: isActive ? 1 : 0.45,
          }}>
          <div style={{ fontSize:11, fontWeight:700, color:isSelected?"#c4b5fd":s.tc,
            fontFamily:"'DM Mono',monospace", letterSpacing:0.5 }}>
            {t("T{n}", { n: config.displayNo ?? config.id })}
          </div>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:0.5, textTransform:"uppercase",
            color:isSelected?PINK:s.tc, marginTop:1 }}>
            {t(s.label)}
          </div>
          {order && ACTIVE_STATUSES.includes(order.status) && (
            <div style={{ fontSize:11, fontWeight:700, color:PINK,
              marginTop:3, fontFamily:"'DM Mono',monospace" }}>
              ₹{fmtNum(Math.round(order.total))}
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
          title={qrStale ? t("QR link needs fixing") : undefined}
          style={qrStale ? { color:"#fbbf24", borderColor:"rgba(245,158,11,0.4)", background:"rgba(245,158,11,0.12)" }
            : { color:"#c4b5fd", borderColor:`${PINK}44`, background:PINK_LIGHT }}>
          {qrStale ? `⚠ ${t("QR")}` : t("QR")}
        </button>
        <button onClick={e=>{ e.stopPropagation(); onToggleStatus(config.id); }}
          className="btn-ghost-dark"
          style={{ color: isActive ? "#f87171" : GREEN,
            borderColor: isActive ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)" }}>
          {isActive ? t("Off") : t("On")}
        </button>
        <button onClick={e=>{ e.stopPropagation(); onDelete(config.id); }}
          className="btn-ghost-dark"
          style={{ color:"#f87171", borderColor:"rgba(239,68,68,0.3)" }}>
          ✕
        </button>
      </div>
      {onAreaChange && (
        <select value={area} onClick={e=>e.stopPropagation()} onChange={e=>onAreaChange(config.id, e.target.value)}
          aria-label={t("Area of {table}", { table: config.name || t("Table {n}", { n: config.id }) })} className="input-dark"
          style={{ marginTop:4, padding:"3px 6px", fontSize:11, width:"auto" }}>
          {TABLE_AREAS.map((a) => <option key={a || "indoor"} value={a}>{t(TABLE_AREA_LABEL[a])}</option>)}
        </select>
      )}
    </div>
  );
};

// ── OrderDrawer ───────────────────────────────────────────────────────────────
const OrderDrawer = ({ config, order, session, onClose, onStatusChange, onClearTable, onSeatsChange, onOpenBilling }) => {
  const [updating,    setUpdating]    = useState(false);
  const [clearing,    setClearing]    = useState(false);
  const [seats,       setSeats]       = useState(String(config.seats));
  const [savingSeats, setSavingSeats] = useState(false);
  useEffect(() => { setSeats(String(config.seats)); }, [config.id, config.seats]);
  const s         = order ? STATUS_STYLE[order.status]||STATUS_STYLE.Empty : STATUS_STYLE.Empty;
  const subtotal  = order?.items?.reduce((sum,i)=>sum+i.price*i.qty,0)||0;
  const settled   = order ? isBillSettled(order) : false;

  const saveSeats = async () => {
    const err = seatsError(seats);
    if (err) return toast.error(err);
    if (Number(seats) === Number(config.seats)) return;
    try { setSavingSeats(true); await onSeatsChange(config.id, Number(seats)); }
    finally { setSavingSeats(false); }
  };

  const handleStatus = async (val) => {
    if (!val||!order) return;
    try { setUpdating(true); await onStatusChange(order._id, val); }
    finally { setUpdating(false); }
  };

  const handleClear = async () => {
    try { setClearing(true); await onClearTable(session); }
    finally { setClearing(false); }
  };

  return (
    <div className="drawer-enter" style={{
      background: CARD, border:`1px solid ${BORDER}`,
      borderRadius:16, padding:24, marginTop:20,
      boxShadow: "0 4px 24px rgba(0,0,0,.2)",
    }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:16, display:"flex", alignItems:"center", gap:10, color:T1 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", color:PINK }}>{config.name || t("T{n}", { n: config.id })}</span>
            <span style={{ fontSize:13, color:T2, fontWeight:400, display:"inline-flex", alignItems:"center", gap:6 }}>
              ·
              <label htmlFor="tbl-seats" style={{ fontSize:12 }}>{t("Seats")}</label>
              <input id="tbl-seats" type="number" min={MIN_SEATS} max={MAX_SEATS} step="1" inputMode="numeric"
                value={seats} onChange={e=>setSeats(e.target.value)}
                onKeyDown={e=>{ if (e.key==="Enter") saveSeats(); }}
                className="input-dark" style={{ width:70, padding:"5px 8px", fontSize:13 }} />
              {Number(seats) !== Number(config.seats) && (
                <button onClick={saveSeats} disabled={savingSeats} className="btn-ghost-dark"
                  style={{ color:"#c4b5fd", borderColor:`${PINK}44`, background:PINK_LIGHT }}>
                  {savingSeats ? <span className="spinner" /> : t("Save")}
                </button>
              )}
            </span>
          </div>
          {order && (
            <div style={{ fontSize:12, color:T2, marginTop:5, fontFamily:"'DM Mono',monospace" }}>
              {order.orderId}
              {customerName(order) && <span style={{ fontFamily:"'DM Sans',sans-serif", marginLeft:8, color:T3 }}>· {customerName(order)}</span>}
            </div>
          )}
          {order && (
            // KH-09 — who took the order; "—" for old orders without a name.
            <div style={{ fontSize:12, color:T3, marginTop:3 }}>
              {t("Waiter")}: <span style={{ color:T2 }}>{takenByName(order) || "—"}</span>
              {takenByIsAcceptor(order) && <span> ({t("accepted")})</span>}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%",
          border:`1px solid ${BORDER}`, background:CARD2, cursor:"pointer",
          fontSize:14, color:T2, display:"flex", alignItems:"center", justifyContent:"center" }} aria-label={t("Close")}>✕</button>
      </div>

      {session && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"10px 14px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.25)",
          borderRadius:10, marginBottom:18, fontSize:12.5 }}>
          <span style={{ color:"#34d399" }}>
            🟢 {t("Occupied since {time}", { time: fmtTime(session.openedAt) })}
          </span>
          <button onClick={handleClear} disabled={clearing} style={{
            padding:"6px 14px", borderRadius:8, border:"none", background:"#16a34a",
            color:"#fff", fontWeight:700, fontSize:11.5, cursor:clearing?"not-allowed":"pointer",
            opacity:clearing?0.6:1,
          }}>
            {clearing ? t("Clearing…") : `🧹 ${t("Clear Table")}`}
          </button>
        </div>
      )}

      {!order ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:T3 }}>
          <div style={{ fontSize:48, marginBottom:10 }}>○</div>
          <div style={{ fontSize:14, color:T2 }}>{t("Table is free")}</div>
          <div style={{ fontSize:12, marginTop:4, color:T3 }}>{t("{n} seats available", { n: config.seats })}</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
          {/* LEFT — items */}
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:12 }}>{t("Order Items")}</div>
            {order.items?.map((item,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center", padding:"9px 0", borderBottom:`1px solid ${BORDER}`, fontSize:13 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:26, height:26, borderRadius:8, background:PINK_LIGHT,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:12, fontWeight:700, color:PINK, fontFamily:"'DM Mono',monospace" }}>
                    {fmtNum(item.qty)}
                  </div>
                  <span style={{ color:T1 }}>{localName(item)}</span>
                </div>
                <span style={{ fontWeight:500, color:T1, fontFamily:"'DM Mono',monospace" }}>
                  ₹{fmtNum(item.price*item.qty)}
                </span>
              </div>
            ))}
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${BORDER}` }}>
              {[
                { l:t("Subtotal"), v:`₹${fmtNum(subtotal)}` },
                ...(order.serviceCharge>0 ? [{ l:t("Service Charge"), v:`₹${fmtNum(order.serviceCharge)}` }] : []),
                ...(order.tax>0           ? [{ l:t("GST"),            v:`₹${fmtNum(order.tax)}`           }] : []),
                ...(order.discount>0      ? [{ l:`${t("Discount")}${order.coupon?.code ? ` (${order.coupon.code})` : ""}`, v:`−₹${fmtNum(order.discount)}` }] : []),
              ].map(r => (
                <div key={r.l} style={{ display:"flex", justifyContent:"space-between",
                  fontSize:12, color:T2, marginBottom:6 }}>
                  <span>{r.l}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace" }}>{r.v}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:16, marginTop:10 }}>
                <span style={{ color:T1 }}>{t("Total")}</span>
                <span style={{ color:PINK, fontFamily:"'DM Mono',monospace" }}>
                  ₹{fmtNum(Math.round(order.total))}
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT — status + bill */}
          <div>
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:10 }}>{t("Current Status")}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
              <span className="tag" style={{ background:s.bg, color:s.tc, border:`1.5px solid ${s.border}` }}>
                {t(s.label)}
              </span>
              <span className="tag" style={{ background:"rgba(139,92,246,0.15)", color:"#c4b5fd",
                border:"1px solid rgba(139,92,246,0.3)" }}>{t("Dining")}</span>
              {/* "PAID" is the real enum (orderStateMachine.js) — this compared
                  against the pre-rename "Paid", so every paid order showed amber. */}
              <span className="tag" style={{
                background: order.paymentStatus==="PAID" ? GREEN_LIGHT : "rgba(245,158,11,0.15)",
                color: order.paymentStatus==="PAID" ? "#34d399" : "#fbbf24",
                border:`1px solid ${order.paymentStatus==="PAID" ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
              }}>{order.paymentStatus==="PAID" ? t("Paid") : t("Payment pending")}</span>
            </div>

            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:10 }}>{t("Update Order")}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:22 }}>
              {ALL_STATUSES.filter(st=>st!==order.status && offersStatus(order, st)).map(st => {
                const stl = STATUS_STYLE[st]||{ bg:"rgba(107,114,128,0.15)", border:"#4b5563", tc:"#9ca3af", label:st };
                const blocked = needsPaidFirst(order, st);
                return (
                  <button key={st} className="status-btn" onClick={()=>!blocked && handleStatus(st)}
                    disabled={updating || blocked} title={blocked ? t(PAID_FIRST_HINT) : undefined}
                    style={{ background:stl.bg, borderColor:stl.border, color:stl.tc, opacity:blocked?0.45:1, cursor:blocked?"not-allowed":undefined }}>
                    {updating ? <span className="spinner" /> : <>{t(stl.label)}{blocked ? ` 🔒 (${t("mark Paid first")})` : ""}</>}
                  </button>
                );
              })}
            </div>

            {/* BIL-01: the floor shows the bill state only — it is settled in Invoices,
                which completes a served order and frees the table. */}
            <div style={{ fontSize:10, fontWeight:600, color:T3, letterSpacing:1.2,
              textTransform:"uppercase", marginBottom:10 }}>{t("Bill")}</div>
            <div style={{
              background: settled ? GREEN_LIGHT : "rgba(245,158,11,0.10)",
              border:`1px solid ${settled ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
              borderRadius:12, padding:14,
            }}>
              <div style={{ fontSize:13, fontWeight:700, color: settled ? "#34d399" : "#fbbf24" }}>
                {settled ? t("Bill settled") : t("Bill open")}
              </div>
              <div style={{ fontSize:12, color:T2, marginTop:4, lineHeight:1.45 }}>
                {settled ? t("The order is completed once it has been served.")
                  : t("Bills are settled in Invoices — settling a served order completes it and frees the table.")}
              </div>
              {!settled && onOpenBilling && (
                <button onClick={onOpenBilling} className="btn-ghost-dark"
                  style={{ marginTop:10, color:"#c4b5fd", borderColor:`${PINK}44`, background:PINK_LIGHT }}>
                  {t("Open Invoices")} →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Waitlist / walk-in queue ────────────────────────────────────────────────
const WAIT_STYLE = {
  WAITING:  { bg:"rgba(245,158,11,0.15)", border:"#f59e0b", tc:"#fbbf24", label:N_("Waiting")  },
  NOTIFIED: { bg:"rgba(59,130,246,0.15)", border:"#378ADD", tc:"#93c5fd", label:N_("Notified") },
};

const timeAgo = (date) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{m}m wait", { m: mins });
  return t("{h}h {m}m wait", { h: Math.floor(mins / 60), m: mins % 60 });
};

const WaitlistRow = ({ entry, freeTables, onSeat, onCancel, busy }) => {
  const [picking, setPicking] = useState(false);
  const s = WAIT_STYLE[entry.status] || WAIT_STYLE.WAITING;
  const eligible = freeTables.filter(tb => tb.seats >= entry.partySize);

  return (
    <div style={{ background:CARD2, border:`1px solid ${BORDER}`, borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontWeight:700, fontSize:13.5, color:T1 }}>{entry.guestName}</span>
            <span className="tag" style={{ background:PINK_LIGHT, color:"#c4b5fd", border:`1px solid ${PINK}44` }}>
              👥 {fmtNum(entry.partySize)}
            </span>
            <span className="tag" style={{ background:s.bg, color:s.tc, border:`1.5px solid ${s.border}` }}>{t(s.label)}</span>
          </div>
          <div style={{ fontSize:11.5, color:T3, marginTop:4 }}>
            {entry.guestPhone && <span>{entry.guestPhone} · </span>}
            <span>{timeAgo(entry.createdAt)}</span>
            {entry.notes && <span> · {entry.notes}</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          <button onClick={() => setPicking(p => !p)} disabled={busy || eligible.length === 0}
            className="btn-ghost-dark" style={{ color: eligible.length ? GREEN : T3,
              borderColor: eligible.length ? "rgba(16,185,129,0.3)" : BORDER,
              opacity: busy || eligible.length === 0 ? 0.5 : 1 }}>
            {busy ? <span className="spinner" /> : t("Seat")}
          </button>
          <button onClick={() => onCancel(entry._id)} disabled={busy} className="btn-ghost-dark"
            style={{ color:"#f87171", borderColor:"rgba(239,68,68,0.3)" }}>✕</button>
        </div>
      </div>

      {picking && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px dashed ${BORDER}`, display:"flex", gap:6, flexWrap:"wrap" }}>
          {eligible.length === 0 ? (
            <span style={{ fontSize:12, color:T3 }}>{t("No free table fits a party of {n} yet.", { n: entry.partySize })}</span>
          ) : eligible.map(tb => (
            <button key={tb.tableNo} onClick={() => { onSeat(entry._id, tb.tableNo); setPicking(false); }}
              className="btn-ghost-dark" style={{ color:GREEN, borderColor:"rgba(16,185,129,0.3)" }}>
              {tableLabel(tb)} · {t("{n} seats", { n: tb.seats })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

function WaitlistPanel({ entries, freeTables, suggestion, onDismissSuggestion, onAdd, onSeat, onCancel }) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [size, setSize]   = useState("2");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const reset = () => { setName(""); setPhone(""); setSize("2"); setNotes(""); };

  const handleAdd = async () => {
    if (!name.trim()) return toast.error(t("Guest name required"));
    setSaving(true);
    try {
      await onAdd({ guestName:name.trim(), guestPhone:phone.trim(), partySize:parseInt(size,10), notes });
      setShowModal(false); reset();
    } finally { setSaving(false); }
  };

  const handleSeat = async (id, tableNo) => { setBusyId(id); try { await onSeat(id, tableNo); } finally { setBusyId(null); } };
  const handleCancel = async (id) => {
    if (!window.confirm(t("Remove this party from the queue?"))) return;
    setBusyId(id); try { await onCancel(id); } finally { setBusyId(null); }
  };

  return (
    <div style={{ background:CARD, borderRadius:16, padding:20, marginBottom:20, border:`1px solid ${BORDER}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontWeight:700, fontSize:15, color:T1 }}>🧍 {t("Walk-in Queue")}</div>
          {entries.length > 0 && (
            <span className="tag" style={{ background:"rgba(245,158,11,0.15)", color:"#fbbf24", border:"1px solid rgba(245,158,11,0.3)" }}>
              {t("{n} waiting", { n: entries.length })}
            </span>
          )}
        </div>
        <button onClick={() => setShowModal(true)} className="btn-ghost-dark"
          style={{ color:"#c4b5fd", borderColor:`${PINK}44`, background:PINK_LIGHT, padding:"7px 14px" }}>
          + {t("Add to Queue")}
        </button>
      </div>

      {suggestion && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap",
          padding:"10px 14px", background:GREEN_LIGHT, border:"1px solid rgba(16,185,129,0.3)", borderRadius:10, marginBottom:14 }}>
          <span style={{ fontSize:12.5, color:"#34d399" }}>
            🟢 {t("{table} just freed up ({seats} seats) — seat {name} (party of {size})?", { table: suggestion.tableName || t("Table {n}", { n: suggestion.tableNo }), seats: suggestion.seats, name: suggestion.suggestedEntry.guestName, size: suggestion.suggestedEntry.partySize })}
          </span>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { handleSeat(suggestion.suggestedEntry._id, suggestion.tableNo); onDismissSuggestion(); }}
              style={{ padding:"6px 14px", borderRadius:8, border:"none", background:"#16a34a", color:"#fff",
                fontWeight:700, fontSize:11.5, cursor:"pointer" }}>
              {t("Seat now")}
            </button>
            <button onClick={onDismissSuggestion} className="btn-ghost-dark">{t("Dismiss")}</button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ textAlign:"center", padding:"20px 0", color:T3, fontSize:13 }}>{t("No one's waiting right now.")}</div>
      ) : entries.map(e => (
        <WaitlistRow key={e._id} entry={e} freeTables={freeTables}
          onSeat={handleSeat} onCancel={handleCancel} busy={busyId === e._id} />
      ))}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ width:380 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, color:T1, marginBottom:18 }}>{t("Add Walk-in to Queue")}</div>

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Guest Name")}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t("e.g. Rohan")}
              className="input-dark" style={{ marginBottom:14 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Phone (optional)")}</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t("e.g. 98765xxxxx")}
              className="input-dark" style={{ marginBottom:14 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Number of People")}</label>
            <input type="number" min="1" value={size} onChange={e => setSize(e.target.value)}
              className="input-dark" style={{ marginBottom:14 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Notes (optional)")}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("e.g. wants a window table")}
              className="input-dark" style={{ marginBottom:20 }} />

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setShowModal(false)} className="btn-ghost-dark"
                style={{ flex:1, padding:12, borderRadius:10, justifyContent:"center", display:"flex" }}>
                {t("Cancel")}
              </button>
              <button onClick={handleAdd} disabled={saving} style={{
                flex:1, padding:12, borderRadius:10,
                background: saving ? "#374151" : `linear-gradient(135deg,${PINK},#5b21b6)`,
                color:"#fff", border:"none", fontWeight:700, cursor:"pointer", fontSize:14,
                opacity:saving?.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                {saving ? <><span className="spinner" />{t("Adding…")}</> : t("Add to Queue")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────
const StatCard = ({ label, val, color }) => (
  <div style={{ background:CARD, borderRadius:12, padding:"14px 18px",
    border:`1px solid ${BORDER}`, boxShadow:"0 2px 8px rgba(0,0,0,.2)" }}>
    <div style={{ fontSize:22, fontWeight:700, color:color||T1, fontFamily:"'DM Mono',monospace" }}>{val}</div>
    <div style={{ fontSize:11, color:T3, marginTop:3, fontWeight:500, letterSpacing:0.3 }}>{label}</div>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TablesPage({ onNavigate }) {
  const [tables,     setTables]     = useState([]);
  const [tableMap,   setTableMap]   = useState({});
  const [sessionMap, setSessionMap] = useState({});
  const [selected,   setSelected]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [showModal,  setShowModal]  = useState(false);
  const [newTableNo, setNewTableNo] = useState("");
  const [newSeats,   setNewSeats]   = useState("4");
  const [newArea,    setNewArea]    = useState(""); // Indoor
  const [creating,   setCreating]   = useState(false);
  const [qrTable,    setQrTable]    = useState(null);
  const [waitlist,   setWaitlist]   = useState([]);
  const [freedSuggestion, setFreedSuggestion] = useState(null);
  const [qrBaseConfigured, setQrBaseConfigured] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [ordersRes, tablesRes, sessionsRes, waitlistRes] = await Promise.all([
        getAllOrders({ limit:100 }),
        getAllTables().catch(()=>({ data:{ tables:[] } })),
        getOpenTableSessions().catch(()=>({ data:{ sessions:[] } })),
        getWaitlist().catch(()=>({ data:{ entries:[] } })),
      ]);
      const orders   = ordersRes?.data?.orders||[];
      const dbTables = tablesRes?.data?.tables||[];
      const sessions = sessionsRes?.data?.sessions||[];
      setWaitlist(waitlistRes?.data?.entries||[]);
      setQrBaseConfigured(tablesRes?.data?.qrBaseConfigured !== false);

      // NOTE: orderType/status moved to DINE_IN / the new canonical status
      // enum in Phase 1 — this must match those, not the old "Dining" /
      // "Completed" strings, or every table would always show as free.
      const NON_TERMINAL = ["PENDING_CONFIRMATION","CONFIRMED","PREPARING","READY","DELIVERED"];
      const oMap = {};
      orders.filter(o=>o.orderType==="DINE_IN"&&o.tableNo&&NON_TERMINAL.includes(o.status))
        .forEach(o=>{ oMap[Number(o.tableNo)] = o; });

      const sMap = {};
      sessions.forEach(s => { sMap[Number(s.tableNo)] = s; });

      setTables(dbTables); setTableMap(oMap); setSessionMap(sMap);
    } catch { setError(t("Failed to load table data")); toast.error(t("Could not load tables")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useVisibleInterval(fetchData, 30000);

  // ── Realtime: a table clearing elsewhere (or here) can surface a queue
  // match instantly instead of waiting for the next 30s poll.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onWaitlist = () => fetchData();
    const onFreed = (p) => { if (p?.suggestedEntry) setFreedSuggestion(p); fetchData(); };
    socket.on("waitlist:updated", onWaitlist);
    socket.on("table:freed", onFreed);
    return () => {
      socket.off("waitlist:updated", onWaitlist);
      socket.off("table:freed", onFreed);
    };
  }, [fetchData]);

  const handleStatusChange  = async (id, ns) => { try { await updateOrderStatus(id,ns); toast.success(`→ ${t(ns)}`); await fetchData(); setSelected(null); } catch (err) { toast.error(err?.response?.data?.message || t("Update failed")); } };
  const handleSeatsChange   = async (tableNo, seats) => { try { await updateTable(tableNo,{ seats }); toast.success(t("{table} now seats {s}", { table: tableLabelByNo(tables, tableNo), s: seats })); await fetchData(); } catch(e) { toast.error(e.response?.data?.message||t("Failed to update")); } };
  // A table in use can't be switched off — the server says so (409).
  const handleToggleStatus  = async (tableNo) => { const tb=tables.find(x=>x.tableNo===tableNo); if(!tb)return; const ns=tb.status==="Active"?"Inactive":"Active"; try { await updateTable(tableNo,{status:ns}); toast.success(`${tableLabel(tb)} → ${t(ns)}`); fetchData(); } catch (e) { toast.error(e.response?.data?.message || t("Failed to update")); } };
  // Area (Indoor / AC Room / Garden): both Table Maps group by it, and new
  // orders on this table take it (AC Room → service charge on the bill).
  const handleAreaChange    = async (tableNo, diningArea) => { try { await updateTable(tableNo,{ diningArea }); toast.success(t("{table} → {area}", { table: tableLabelByNo(tables, tableNo), area: t(TABLE_AREA_LABEL[diningArea]) })); fetchData(); } catch (e) { toast.error(e.response?.data?.message || t("Failed to update")); } };
  const handleDelete        = async (tableNo) => { if(!window.confirm(t("Delete {table}?", { table: tableLabelByNo(tables, tableNo) })))return; try { await deleteTable(tableNo); toast.success(t("{table} deleted", { table: tableLabelByNo(tables, tableNo) })); fetchData(); if(selected===tableNo)setSelected(null); } catch(e){ toast.error(e.response?.data?.message||t("Failed")); } };
  const handleTakeawayQR = async () => {
    try {
      const { data } = await getTakeawayQR();
      setQrTable({ takeaway: true, qrCode: data.qrCode, qrUrl: data.qrUrl });
    } catch { toast.error(t("Couldn't load takeaway QR")); }
  };
  // Mockup parity: every active table's QR on one printout (one per card).
  const handlePrintAll = () => {
    const list = tables.filter((tb) => tb.qrCode && (tb.status || "Active") === "Active"); // server order: by area, then number
    if (!list.length) return toast.error(t("No table QR codes to print"));
    let el = document.getElementById("qr-print-area");
    if (!el) { el = document.createElement("div"); el.id = "qr-print-area"; document.body.appendChild(el); }
    el.style.display = "none";
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:24px;justify-content:center;font-family:sans-serif;padding:20px">${list.map((tb) => `
      <div style="width:240px;text-align:center;page-break-inside:avoid;border:1px solid #ddd;border-radius:12px;padding:14px">
        <div style="font-size:20px;font-weight:800;margin-bottom:10px">${tableLabel(tb)}</div>
        <img src="${tb.qrCode}" style="width:200px;height:200px"/>
        <div style="font-size:11px;color:#777;margin-top:8px">${t("Scan to order instantly")}</div>
      </div>`).join("")}</div>`;
    window.print();
  };
  const handleRegenerate    = async (tableNo, opts) => { const { data }=await regenerateQR(tableNo, opts); setTables(p=>p.map(tb=>tb.tableNo===tableNo?{...tb,qrCode:data.qrCode,qrUrl:data.qrUrl,qrStale:false}:tb)); return { data }; };
  const handleClearTable    = async (session) => {
    if (!session?._id) return;
    if (!window.confirm(t("Clear {table}? This closes the table's session.", { table: tableLabelByNo(tables, session.tableNo) }))) return;
    try {
      const { data } = await clearTableSession(session._id);
      toast.success(t("{table} cleared", { table: tableLabelByNo(tables, session.tableNo) }));
      if (data?.suggestedEntry) {
        setFreedSuggestion({ tableNo: session.tableNo, tableName: tableLabelByNo(tables, session.tableNo), seats: selectedConf?.seats, suggestedEntry: data.suggestedEntry });
      }
      await fetchData();
      setSelected(null);
    } catch (e) {
      toast.error(e.response?.data?.message || t("Cannot clear table — it may still have active orders"));
    }
  };

  const handleAddWaitlist = async (body) => {
    try { await addWaitlistEntry(body); toast.success(t("{name} added to queue", { name: body.guestName })); await fetchData(); }
    catch (e) { toast.error(e.response?.data?.message || t("Failed to add to queue")); }
  };
  const handleSeatWaitlist = async (id, tableNo) => {
    try {
      await seatWaitlistEntry(id, tableNo);
      toast.success(t("Seated at {table}", { table: tableLabelByNo(tables, tableNo) }));
      setFreedSuggestion(null);
      await fetchData();
    } catch (e) { toast.error(e.response?.data?.message || t("Failed to seat — table may already be taken")); }
  };
  const handleCancelWaitlist = async (id) => {
    try { await cancelWaitlistEntry(id); toast.success(t("Removed from queue")); await fetchData(); }
    catch (e) { toast.error(e.response?.data?.message || t("Failed to remove")); }
  };

  const handleCreate = async () => {
    const no = Number(newTableNo);
    if (!newTableNo || !Number.isInteger(no) || no < 1) return toast.error(t("Table number required"));
    const err = seatsError(newSeats);
    if (err) return toast.error(err);
    setCreating(true);
    try {
      const { data: made } = await createTable({ tableNo:parseInt(newTableNo), seats:parseInt(newSeats), diningArea:newArea });
      toast.success(t("{table} created!", { table: tableLabel({ displayNo: no, diningArea: newArea }) }));
      setShowModal(false); setNewTableNo(""); setNewSeats("4"); // keep the area for the next table
      await fetchData();
      const res = await getAllTables();
      // By the new table's internal key — "Indoor-AC 1" may be internal table 15,
      // and internal table 1 may be a different (Indoor) table.
      const createdNo = made?.table?.tableNo;
      const created = (res.data?.tables||[]).find(tb=>tb.tableNo===createdNo);
      if (created) setQrTable(created);
    } catch(e) { toast.error(e.response?.data?.message||t("Failed to create")); }
    finally { setCreating(false); }
  };

  const activeTables  = tables.filter(tb=>tb.status==="Active"||!tb.status);
  const occupied      = activeTables.filter(tb=>tableMap[tb.tableNo]).length;
  const freeTables    = activeTables.filter(tb=>(tb.occupancyStatus||"AVAILABLE")==="AVAILABLE")
    .map(tb=>({ tableNo:tb.tableNo, seats:tb.seats }));
  const revenue       = Object.values(tableMap).reduce((s,o)=>s+Number(o.total||0),0);
  // Served but bill still open — waiting to be settled in Invoices (BIL-01).
  const billsOpen     = Object.values(tableMap).filter(o=>o.status==="DELIVERED"&&!isBillSettled(o)).length;
  const staleQrs      = tables.filter(tb=>tb.qrStale).length;
  const selectedConf  = selected ? tables.find(tb=>tb.tableNo===selected) : null;
  const selectedOrder = selected ? tableMap[selected]||null : null;
  const selectedSession = selected ? sessionMap[selected]||null : null;

  if (loading) return (
    <div className="tables-root" style={{ textAlign:"center", padding:100, color:T3 }}>
      <div className="spinner" style={{ width:32, height:32, borderWidth:3,
        borderColor:"rgba(124,58,237,.2)", borderTopColor:PINK, margin:"0 auto 16px" }} />
      <div style={{ fontSize:14 }}>{t("Loading floor plan…")}</div>
    </div>
  );
  if (error) return (
    <div className="tables-root" style={{ textAlign:"center", padding:80, color:"#f87171" }}>
      <div style={{ fontSize:16, marginBottom:14 }}>{error}</div>
      <button onClick={fetchData} style={{ padding:"10px 28px", background:PINK, color:"#fff",
        border:"none", borderRadius:25, fontWeight:600, cursor:"pointer" }}>{t("Retry")}</button>
    </div>
  );

  return (
    <div className="tables-root" style={{ padding:28 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>{t("Table Management")}</h1>
          <div style={{ fontSize:13, color:T2, marginTop:4, display:"flex", alignItems:"center", gap:10 }}>
            <span>{t("Dining Floor")}</span>
            <span style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span className="pulse-live" style={{ width:7, height:7, borderRadius:"50%",
                background:GREEN, display:"inline-block" }} />
              <span style={{ color:GREEN, fontWeight:500 }}>{t("Live")}</span>
              <span style={{ color:T3 }}>· {t("every 30s")}</span>
            </span>
            {billsOpen>0 && (
              <span className="tag" style={{ background:"rgba(245,158,11,0.15)",
                color:"#fbbf24", border:"1px solid rgba(245,158,11,0.3)", fontSize:11 }}>
                {tn(billsOpen, "{n} served table to settle", "{n} served tables to settle")}
              </span>
            )}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button onClick={handlePrintAll} className="qr-btn"
          style={{ background:PINK_LIGHT, color:"#c4b5fd", borderColor:`${PINK}44`, borderRadius:25 }}>
          🖨 {t("Print all QR codes")}
        </button>
        <button onClick={()=>setShowModal(true)} style={{
          padding:"11px 22px", background:`linear-gradient(135deg,${PINK},#5b21b6)`,
          color:"#fff", border:"none", borderRadius:25, fontWeight:700,
          cursor:"pointer", fontSize:13, boxShadow:`0 4px 16px ${PINK}44`,
        }}>+ {t("New Table")}</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:22 }}>
        <StatCard label={t("Occupied")}         val={fmtNum(occupied)}                                color={PINK}    />
        <StatCard label={t("Free")}             val={fmtNum(activeTables.length-occupied)}            color={GREEN}   />
        <StatCard label={t("Active Revenue")}   val={`₹${fmtNum(Math.round(revenue))}`}                              />
        <StatCard label={t("Total Tables")}     val={fmtNum(tables.length)}                                           />
        <StatCard label={t("Served · bill open")} val={fmtNum(billsOpen)} color={billsOpen>0?"#fbbf24":GREEN}         />
      </div>

      {/* TBL-01: printed QRs that won't open the customer app */}
      {(!qrBaseConfigured || staleQrs>0) && (
        <div role="alert" style={{ marginBottom:16, padding:"12px 16px", borderRadius:10, fontSize:12.5, lineHeight:1.5,
          background:"rgba(245,158,11,0.10)", border:"1px solid rgba(245,158,11,0.35)", color:"#fbbf24" }}>
          {!qrBaseConfigured
            ? `⚠ ${t("The customer app address isn't set on the server (CUSTOMER_FRONTEND_URL), so table QR codes can't be made correctly. Ask your technical person to set it.")}`
            : `⚠ ${tn(staleQrs, "{n} table QR points to an old or wrong link. Open its QR and press “Fix link”, then reprint it.", "{n} table QRs point to an old or wrong link. Open each QR and press “Fix link”, then reprint it.")}`}
        </div>
      )}

      {/* Legend */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:16,
        padding:"10px 16px", background:CARD, borderRadius:10, border:`1px solid ${BORDER}` }}>
        {[
          { label:N_("Free"),             bg:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.15)" },
          { label:N_("Placed"),           bg:"rgba(56,122,221,0.15)",  border:"#378ADD" },
          { label:N_("Cooking"),          bg:"rgba(186,117,23,0.15)",  border:"#BA7517" },
          { label:N_("Ready to Deliver"), bg:GREEN_LIGHT,              border:GREEN },
          { label:N_("Occupied chair"),   bg:PINK_LIGHT,               border:PINK },
        ].map(l => (
          <div key={l.label} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T2 }}>
            <div className={l.blink?"blink-pending":""} style={{ width:10, height:10, borderRadius:3,
              background:l.bg, border:`1.5px solid ${l.border}` }} />
            {t(l.label)}
          </div>
        ))}
      </div>

      {/* Walk-in queue */}
      <WaitlistPanel
        entries={waitlist}
        freeTables={freeTables}
        suggestion={freedSuggestion}
        onDismissSuggestion={()=>setFreedSuggestion(null)}
        onAdd={handleAddWaitlist}
        onSeat={handleSeatWaitlist}
        onCancel={handleCancelWaitlist}
      />

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
          textAlign:"center", padding:"10px 0 20px" }}>{t("Window side")}</div>

        {tables.length===0 ? (
          <div style={{ textAlign:"center", padding:"48px 20px", color:T3 }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🪑</div>
            <div style={{ fontSize:14, color:T2 }}>{t("No tables yet")}</div>
            <button onClick={()=>setShowModal(true)} style={{ marginTop:12, padding:"10px 24px",
              background:`linear-gradient(135deg,${PINK},#5b21b6)`, color:"#fff",
              border:"none", borderRadius:25, fontWeight:600, cursor:"pointer" }}>
              + {t("Add First Table")}
            </button>
          </div>
        ) : (
          groupTablesByArea(tables).map((g) => (
          <div key={g.area || "indoor"} style={{ paddingBottom:28 }}>
          <div style={{ fontSize:12, fontWeight:700, color:T1, letterSpacing:0.5, textAlign:"center", marginBottom:14 }}>
            {t(TABLE_AREA_LABEL[g.area] || g.area)} <span style={{ color:T3, fontWeight:500 }}>· {tn(g.tables.filter(x=>(x.status||"Active")==="Active").length, "{n} active table", "{n} active tables")}</span>
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:40, justifyContent:"center" }}>
            {g.tables.map(tb => (
              <TableCard key={tb.tableNo}
                area={tb.diningArea || ""}
                onAreaChange={handleAreaChange}
                config={{ id:tb.tableNo, seats:tb.seats, displayNo:tb.displayNo ?? tb.tableNo, name:tableLabel(tb) }}
                order={tableMap[tb.tableNo]||null}
                qrStale={!!tb.qrStale}
                onClick={()=>setSelected(selected===tb.tableNo?null:tb.tableNo)}
                isSelected={selected===tb.tableNo}
                tableStatus={tb.status||"Active"}
                onToggleStatus={handleToggleStatus}
                onDelete={handleDelete}
                onQR={()=>setQrTable(tb)}
              />
            ))}
          </div>
          </div>
          ))
        )}

        <div style={{ width:"100%", height:1, margin:"0 0 18px",
          background:`repeating-linear-gradient(90deg,${BORDER} 0,${BORDER} 8px,transparent 8px,transparent 16px)` }} />
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:10, color:T3, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>
            {t("Counter & Entrance")}
          </div>
          <div style={{ width:40, height:6, background:"rgba(139,92,246,0.4)", borderRadius:3, margin:"0 auto" }} />
          <button onClick={handleTakeawayQR} className="qr-btn"
            style={{ margin:"14px auto 0", background:PINK_LIGHT, color:"#c4b5fd", borderColor:`${PINK}44` }}>
            🛍️ {t("Takeaway QR")}
          </button>
        </div>
      </div>

      {/* Order Drawer */}
      {selected && selectedConf && (
        <OrderDrawer
          config={{ id:selectedConf.tableNo, seats:selectedConf.seats, name:tableLabel(selectedConf) }}
          order={selectedOrder} session={selectedSession}
          onClose={()=>setSelected(null)}
          onStatusChange={handleStatusChange}
          onClearTable={handleClearTable}
          onSeatsChange={handleSeatsChange}
          onOpenBilling={onNavigate ? ()=>onNavigate("invoices") : undefined}
        />
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal-box" style={{ width:380 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, color:T1, marginBottom:4 }}>{t("Add New Table")}</div>
            <div style={{ marginBottom:18 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Table Number")}</label>
            <input type="number" placeholder={t("e.g. 9")} value={newTableNo}
              onChange={e=>setNewTableNo(e.target.value)}
              className="input-dark" style={{ marginBottom:14 }} />

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Seating Capacity")}</label>
            <input type="number" min={MIN_SEATS} max={MAX_SEATS} step="1" inputMode="numeric"
              placeholder={t("e.g. 4")} value={newSeats} onChange={e=>setNewSeats(e.target.value)}
              aria-invalid={!!(newSeats && seatsError(newSeats))}
              className="input-dark" style={{ marginBottom:newSeats && seatsError(newSeats) ? 6 : 14 }} />
            {newSeats && seatsError(newSeats) && (
              <div style={{ fontSize:11.5, color:"#f87171", marginBottom:14 }}>{seatsError(newSeats)}</div>
            )}

            <label style={{ fontSize:12, color:T2, fontWeight:600, display:"block", marginBottom:6 }}>{t("Area")}</label>
            <select value={newArea} onChange={e=>setNewArea(e.target.value)} className="input-dark" style={{ marginBottom:14 }}>
              {TABLE_AREAS.map((a) => <option key={a || "indoor"} value={a}>{t(TABLE_AREA_LABEL[a])}</option>)}
            </select>

            <div style={{ fontSize:12, color:T2, marginBottom:20 }}>
              {t("Unique QR code for the table will be auto generated.")}
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowModal(false)} className="btn-ghost-dark"
                style={{ flex:1, padding:12, borderRadius:10, justifyContent:"center", display:"flex" }}>
                {t("Cancel")}
              </button>
              <button onClick={handleCreate} disabled={creating} style={{
                flex:1, padding:12, borderRadius:10,
                background: creating ? "#374151" : `linear-gradient(135deg,${PINK},#5b21b6)`,
                color:"#fff", border:"none", fontWeight:700, cursor:"pointer", fontSize:14,
                opacity:creating?.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                {creating ? <><span className="spinner" />{t("Creating…")}</> : t("Create + QR")}
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