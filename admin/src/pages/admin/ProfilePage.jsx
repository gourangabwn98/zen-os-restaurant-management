import { PRIMARY, PRIMARY_LIGHT, PRIMARY_DARK } from "../../theme.js";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
  getRestaurantProfile, updateRestaurantProfile, uploadRestaurantLogo,
  uploadRestaurantBanner, updateRestaurantBanner, deleteRestaurantBanner,
  addRestaurantPrinter, updateRestaurantPrinter, deleteRestaurantPrinter,
} from "../../services/adminService.js";

const PINK     = PRIMARY;
const PINK_DARK= PRIMARY_DARK;
const PINK_BG  = PRIMARY_LIGHT;
const GREEN_BG = "rgba(16,185,129,0.12)";
const CARD     = "#16132a";
const CARD2    = "#1c1830";
const BORDER   = "rgba(255,255,255,0.07)";
const SURFACE  = "#252038";
const T1       = "#f1f0f5";
const T2       = "#9ca3af";
// NOTE: original value "#4b5563" had ~2.4:1 contrast against the dark
// surfaces above (CARD/CARD2/SURFACE), which is why labels, hints,
// "empty" values, badge text, banner/printer meta text, and the loading
// copy were all reading as barely visible. Bumped to a lighter,
// theme-matched lavender-gray with ~5.6:1 contrast so the same text
// stays legible without changing any layout or behavior.
const T3       = "#8b8fa3";

if (!document.getElementById("profile-page-styles")) {
  const s = document.createElement("style");
  s.id = "profile-page-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
    .pp * { box-sizing:border-box; font-family:'DM Sans',sans-serif; }
    @keyframes pp-slide { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

    /* ── Cards ── */
    .pp-card { background:${CARD}; border:1px solid ${BORDER}; border-radius:16px; padding:24px; margin-bottom:12px; }

    /* ── Labels & values ── */
    .pp-label { font-size:11px; color:${T3}; text-transform:uppercase; letter-spacing:.8px; font-weight:600; margin-bottom:4px; }
    .pp-val   { font-size:14px; color:${T1}; }
    .pp-val.empty { color:${T3}; font-style:italic; }

    /* ── Inputs ── */
    .pp-input {
      width:100%; padding:10px 13px; border:1px solid rgba(255,255,255,0.1); border-radius:10px;
      font-size:14px; font-family:'DM Sans',sans-serif; outline:none;
      background:${SURFACE}; color:${T1}; transition:border .15s; box-sizing:border-box;
    }
    .pp-input:focus { border-color:rgba(124,58,237,0.5); box-shadow:0 0 0 3px rgba(124,58,237,0.1); }
    .pp-input option { background:${CARD}; color:${T1}; }
    .pp-textarea {
      width:100%; padding:10px 13px; border:1px solid rgba(255,255,255,0.1); border-radius:10px;
      font-size:14px; font-family:'DM Sans',sans-serif; outline:none; resize:vertical;
      min-height:80px; background:${SURFACE}; color:${T1}; transition:border .15s; box-sizing:border-box;
    }
    .pp-textarea:focus { border-color:rgba(124,58,237,0.5); box-shadow:0 0 0 3px rgba(124,58,237,0.1); }
    /* Browser default placeholder color is unreadable on a dark
       background, which was making every empty input look blank.
       Set an explicit, visible placeholder tone. */
    .pp-input::placeholder, .pp-textarea::placeholder { color:rgba(241,240,245,0.38); opacity:1; }

    /* ── Grids ── */
    .pp-edit-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 18px; animation:pp-slide .18s ease; }
    .pp-view-grid { display:grid; grid-template-columns:1fr 1fr; gap:2px 24px; }
    .pp-view-grid.cols3 { grid-template-columns:1fr 1fr 1fr; }
    .pp-view-item { padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
    .pp-view-item:last-child { border-bottom:none; }
    .pp-field-full { grid-column:1/-1; }

    /* ── Section buttons ── */
    .pp-edit-btn {
      font-size:12px; font-family:'DM Sans',sans-serif; color:${T2};
      background:rgba(255,255,255,0.05); border:1px solid ${BORDER};
      border-radius:20px; padding:5px 14px; cursor:pointer; transition:all .12s;
    }
    .pp-edit-btn:hover { color:${T1}; background:rgba(255,255,255,0.1); }
    .pp-save-btn {
      font-size:12px; font-family:'DM Sans',sans-serif; color:#fff;
      background:linear-gradient(135deg,${PINK},#5b21b6);
      border:none; border-radius:20px; padding:5px 14px; cursor:pointer;
      margin-left:6px; transition:opacity .12s;
    }
    .pp-save-btn:hover { opacity:.88; }
    .pp-cancel-btn {
      font-size:12px; font-family:'DM Sans',sans-serif; color:${T2};
      background:none; border:1px solid ${BORDER}; border-radius:20px;
      padding:5px 14px; cursor:pointer;
    }

    /* ── Service chips ── */
    .pp-chip {
      display:inline-flex; align-items:center; gap:6px; padding:6px 16px;
      border-radius:20px; border:1px solid ${BORDER}; font-size:13px;
      cursor:pointer; color:${T2}; background:${CARD2};
      transition:all .12s; user-select:none;
    }
    .pp-chip.on { background:${PINK_BG}; border-color:${PINK}; color:#c4b5fd; font-weight:500; }

    /* ── Service badges (view mode) ── */
    .pp-badge {
      display:inline-flex; align-items:center; padding:3px 11px; border-radius:20px;
      font-size:12px; background:rgba(255,255,255,0.05); color:${T3}; border:1px solid ${BORDER};
    }
    .pp-badge.on { background:${PINK_BG}; color:#c4b5fd; border-color:rgba(124,58,237,0.3); }

    /* ── Location & upload buttons ── */
    .pp-loc-btn {
      margin-top:10px; padding:8px 16px; background:${CARD2}; border:1px solid ${BORDER};
      border-radius:20px; font-size:13px; font-family:'DM Sans',sans-serif;
      cursor:pointer; color:${T2}; transition:all .12s;
    }
    .pp-loc-btn:hover { background:rgba(255,255,255,0.08); color:${T1}; }
    .pp-upload-lbl {
      display:inline-block; padding:8px 18px; background:${CARD2};
      border:1px solid ${BORDER}; border-radius:20px; font-size:13px;
      cursor:pointer; color:${T2}; transition:all .12s;
    }
    .pp-upload-lbl:hover { background:rgba(255,255,255,0.08); color:${T1}; }

    /* ── Save all ── */
    .pp-save-all {
      background:linear-gradient(135deg,${PINK},#5b21b6); color:#fff;
      padding:13px 40px; border:none; border-radius:30px; font-size:15px;
      font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer;
      box-shadow:0 4px 18px rgba(124,58,237,0.35); transition:all .15s;
    }
    .pp-save-all:hover    { opacity:.9; transform:translateY(-1px); }
    .pp-save-all:disabled { opacity:.55; cursor:not-allowed; transform:none; }

    /* ── Banner & Printer rows ── */
    .pp-list-row {
      display:flex; align-items:center; gap:12px; padding:10px 0;
      border-bottom:1px solid rgba(255,255,255,0.05); animation:pp-slide .15s ease;
    }
    .pp-list-row:last-child { border-bottom:none; }
    .pp-icon-btn {
      width:30px; height:30px; border-radius:8px; border:1px solid ${BORDER};
      background:${CARD2}; cursor:pointer; display:inline-flex; align-items:center;
      justify-content:center; font-size:13px; transition:all .12s; flex-shrink:0;
    }
    .pp-icon-btn:hover { background:rgba(255,255,255,0.08); }
    .pp-icon-btn.danger:hover { background:rgba(239,68,68,0.15); border-color:rgba(239,68,68,0.3); }
    .pp-add-row {
      display:flex; align-items:center; gap:10px; padding-top:14px;
      border-top:1px solid rgba(255,255,255,0.05); margin-top:6px; flex-wrap:wrap;
    }
    .pp-add-btn {
      padding:7px 18px; background:linear-gradient(135deg,${PINK},#5b21b6); color:#fff;
      border:none; border-radius:20px; font-size:13px; font-family:'DM Sans',sans-serif;
      cursor:pointer; transition:opacity .12s; white-space:nowrap;
    }
    .pp-add-btn:disabled { opacity:.55; cursor:not-allowed; }
    .pp-add-btn:hover:not(:disabled) { opacity:.88; }

    /* ── Toggle switch ── */
    .pp-toggle { position:relative; width:36px; height:20px; flex-shrink:0; }
    .pp-toggle input { opacity:0; width:0; height:0; }
    .pp-toggle-slider {
      position:absolute; inset:0; background:rgba(255,255,255,0.1);
      border-radius:20px; cursor:pointer; transition:.2s;
    }
    .pp-toggle-slider:before {
      content:''; position:absolute; width:14px; height:14px;
      left:3px; top:3px; background:#fff; border-radius:50%; transition:.2s;
    }
    .pp-toggle input:checked + .pp-toggle-slider { background:${PINK}; }
    .pp-toggle input:checked + .pp-toggle-slider:before { transform:translateX(16px); }

    /* ── Misc ── */
    .pp-thumb {
      object-fit:cover; border-radius:7px;
      border:1px solid ${BORDER}; flex-shrink:0; background:${SURFACE};
    }
    .pp-status-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  `;
  document.head.appendChild(s);
}

const fmt12 = (t) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${m < 10 ? "0" : ""}${m} ${ampm}`;
};
const orDash = (v) => (v && String(v).trim() ? v : "—");

const SectionCard = ({ icon, iconBg, title, editing, onEdit, onSave, onCancel, viewContent, editContent }) => (
  <div className="pp-card">
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:30, height:30, borderRadius:8, background:iconBg,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>{icon}</div>
        <span style={{ fontSize:15, fontWeight:600, color:T1 }}>{title}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center" }}>
        {editing ? (
          <>
            <button className="pp-cancel-btn" onClick={onCancel}>Cancel</button>
            <button className="pp-save-btn"   onClick={onSave}>Save</button>
          </>
        ) : (
          <button className="pp-edit-btn" onClick={onEdit}>Edit</button>
        )}
      </div>
    </div>
    {editing ? editContent : viewContent}
  </div>
);

const ViewItem = ({ label, value, full }) => (
  <div className={`pp-view-item${full ? " pp-field-full" : ""}`}>
    <div className="pp-label">{label}</div>
    <div className={`pp-val${!value || value === "—" ? " empty" : ""}`}>{value || "—"}</div>
  </div>
);

const Field = ({ label, children, full }) => (
  <div className={full ? "pp-field-full" : ""}>
    <div style={{ fontSize:12, color:T2, marginBottom:5, fontWeight:500 }}>{label}</div>
    {children}
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <label className="pp-toggle">
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span className="pp-toggle-slider" />
  </label>
);

export default function ProfilePage() {
  const DEFAULTS = {
    restaurantName:"", phone:"", email:"", contactPerson:"", logo:"",
    address:"", city:"", latitude:"", longitude:"",
    dineInRange:50, deliveryRange:5000,
    fssaiNumber:"", gstNumber:"", aboutRestaurant:"", gstRate:0,
    openingTime:"09:00", closingTime:"22:00", avgDeliveryTime:30,
    minOrderAmount:0, freeDeliveryAbove:300, deliveryBaseFee:40,
    deliveryFeePerKm:8, serviceCharge:0, packingCharge:0,
    socialInstagram:"", socialFacebook:"", website:"",
    services:{ dineIn:true, takeAway:true, delivery:true },
    notificationSound:true, banners:[], printerIps:[],
    upiId:"", upiPayeeName:"",
  };

  const [profile,    setProfile]    = useState(DEFAULTS);
  const [draft,      setDraft]      = useState(DEFAULTS);
  const [editing,    setEditing]    = useState({});
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [logoPreview,setLogoPreview]= useState("");
  const [bannerFile,    setBannerFile]      = useState(null);
  const [bannerLink,    setBannerLink]      = useState("");
  const [bannerUploading,setBannerUploading]= useState(false);
  const [newPrinterIp,  setNewPrinterIp]   = useState("");
  const [newPrinterName,setNewPrinterName]  = useState("");
  const [printerSaving, setPrinterSaving]  = useState(false);
  const logoFileRef   = useRef();
  const bannerFileRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const res = await getRestaurantProfile();
        if (res?.data?.data) {
          const d = res.data.data;
          const merged = { ...DEFAULTS, ...d,
            services:   { ...DEFAULTS.services,   ...(d.services   || {}) },
            banners:    d.banners    || [],
            printerIps: d.printerIps || [],
          };
          setProfile(merged); setDraft(merged);
        }
      } catch { toast.error("Failed to load profile"); }
      finally  { setLoading(false); }
    })();
  }, []);

  const startEdit  = (sec) => { setDraft({ ...profile }); setEditing(p=>({ ...p, [sec]:true  })); };
  const cancelEdit = (sec) => {                            setEditing(p=>({ ...p, [sec]:false })); };

  const sectionFields = (sec) => {
    const pick = (...keys) => Object.fromEntries(keys.map(k=>[k,draft[k]]));
    switch (sec) {
      case "basic":   return pick("restaurantName","phone","email","contactPerson");
      case "address": return pick("address","city","latitude","longitude","dineInRange","deliveryRange");
      case "biz":     return pick("fssaiNumber","gstNumber","aboutRestaurant");
      case "hours":   return pick("openingTime","closingTime","avgDeliveryTime");
      case "pricing": return pick("minOrderAmount","freeDeliveryAbove","deliveryBaseFee","deliveryFeePerKm","serviceCharge","packingCharge","gstRate");
      case "payment": return pick("upiId","upiPayeeName");
      case "social":  return pick("socialInstagram","socialFacebook","website");
      case "services":return pick("services","notificationSound");
      default:        return {};
    }
  };

  const saveSection = async (sec) => {
    try {
      const updated = { ...profile, ...sectionFields(sec) };
      if (sec === "payment" && updated.upiId) {
        // Basic UPI VPA shape check (name@bank) — good enough to catch typos
        // before saving; the customer app already treats a blank/invalid
        // upiId as "no UPI configured" and hides the option, so a bad value
        // here would silently break online payment for every customer.
        const upiPattern = /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiPattern.test(updated.upiId.trim())) {
          toast.error("Enter a valid UPI ID, e.g. restaurantname@okhdfcbank");
          return;
        }
        updated.upiId = updated.upiId.trim();
      }
      setProfile(updated); setEditing(p=>({ ...p, [sec]:false }));
      await updateRestaurantProfile(updated);
      toast.success("Section saved");
    } catch { toast.error("Failed to save"); }
  };

  const set       = (k,v) => setDraft(p=>({ ...p, [k]:v }));
  const setNum    = (k,v) => setDraft(p=>({ ...p, [k]:Number(v) }));
  const setService= (svc) => setDraft(p=>({ ...p, services:{ ...p.services, [svc]:!p.services[svc] } }));

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLogoPreview(URL.createObjectURL(file)); setUploading(true);
    const fd = new FormData(); fd.append("logo", file);
    try {
      const res = await uploadRestaurantLogo(fd);
      const url = res?.data?.logoUrl;
      setProfile(p=>({ ...p, logo:url })); setDraft(p=>({ ...p, logo:url }));
      toast.success("Logo uploaded");
    } catch { toast.error("Failed to upload logo"); setLogoPreview(""); }
    finally  { setUploading(false); }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return toast.error("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setDraft(p=>({ ...p, latitude:coords.latitude.toFixed(6), longitude:coords.longitude.toFixed(6) })); toast.success("Location fetched"); },
      () => toast.error("Could not get location"),
    );
  };

  const handleAddBanner = async () => {
    if (!bannerFile) return toast.error("Please select an image");
    setBannerUploading(true);
    try {
      const fd = new FormData(); fd.append("banner", bannerFile);
      if (bannerLink) fd.append("link", bannerLink); fd.append("active","true");
      const res = await uploadRestaurantBanner(fd);
      const upd = res?.data?.data;
      if (upd) { setProfile(p=>({ ...p, banners:upd.banners })); setDraft(p=>({ ...p, banners:upd.banners })); }
      setBannerFile(null); setBannerLink("");
      if (bannerFileRef.current) bannerFileRef.current.value = "";
      toast.success("Banner added");
    } catch { toast.error("Failed to upload banner"); }
    finally  { setBannerUploading(false); }
  };

  const handleToggleBanner = async (banner) => {
    const optimistic = profile.banners.map(b=>b._id===banner._id?{ ...b, active:!b.active }:b);
    setProfile(p=>({ ...p, banners:optimistic }));
    try { await updateRestaurantBanner(banner._id, { active:!banner.active }); }
    catch { toast.error("Failed"); setProfile(p=>({ ...p, banners:profile.banners })); }
  };

  const handleDeleteBanner = async (id) => {
    if (!window.confirm("Delete this banner?")) return;
    try {
      const res = await deleteRestaurantBanner(id); const upd = res?.data?.data;
      if (upd) { setProfile(p=>({ ...p, banners:upd.banners })); setDraft(p=>({ ...p, banners:upd.banners })); }
      toast.success("Banner deleted");
    } catch { toast.error("Failed"); }
  };

  const handleAddPrinter = async () => {
    if (!newPrinterIp.trim()) return toast.error("Enter an IP address");
    setPrinterSaving(true);
    try {
      const res = await addRestaurantPrinter({ ip:newPrinterIp.trim(), name:newPrinterName.trim()||"Printer", active:true });
      const upd = res?.data?.data;
      if (upd) { setProfile(p=>({ ...p, printerIps:upd.printerIps })); setDraft(p=>({ ...p, printerIps:upd.printerIps })); }
      setNewPrinterIp(""); setNewPrinterName(""); toast.success("Printer added");
    } catch { toast.error("Failed"); }
    finally  { setPrinterSaving(false); }
  };

  const handleTogglePrinter = async (printer) => {
    const optimistic = profile.printerIps.map(p=>p._id===printer._id?{ ...p, active:!p.active }:p);
    setProfile(p=>({ ...p, printerIps:optimistic }));
    try { await updateRestaurantPrinter(printer._id, { active:!printer.active }); }
    catch { toast.error("Failed"); setProfile(p=>({ ...p, printerIps:profile.printerIps })); }
  };

  const handleDeletePrinter = async (id) => {
    if (!window.confirm("Remove this printer?")) return;
    try {
      const res = await deleteRestaurantPrinter(id); const upd = res?.data?.data;
      if (upd) { setProfile(p=>({ ...p, printerIps:upd.printerIps })); setDraft(p=>({ ...p, printerIps:upd.printerIps })); }
      toast.success("Printer removed");
    } catch { toast.error("Failed"); }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try { await updateRestaurantProfile(profile); toast.success("All settings saved!"); }
    catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ textAlign:"center", padding:"100px 0", color:T3, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ width:28, height:28, borderRadius:"50%", border:`3px solid ${PINK}22`,
        borderTopColor:PINK, animation:"spin .7s linear infinite", margin:"0 auto 14px" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize:14 }}>Loading profile…</div>
    </div>
  );

  const logoSrc = logoPreview || profile.logo;

  return (
    <div className="pp" style={{ maxWidth:860, margin:"0 auto", padding:"28px 0 60px" }}>

      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:T1, margin:0 }}>Restaurant Profile</h1>
        <p style={{ fontSize:13, color:T2, marginTop:4 }}>View and manage your restaurant information</p>
      </div>

      {/* 1 — Basic */}
      <SectionCard icon="🏪" iconBg={PINK_BG} title="Basic information"
        editing={editing.basic} onEdit={()=>startEdit("basic")} onCancel={()=>cancelEdit("basic")} onSave={()=>saveSection("basic")}
        viewContent={<div className="pp-view-grid">
          <ViewItem label="Restaurant name" value={orDash(profile.restaurantName)} />
          <ViewItem label="Phone"           value={orDash(profile.phone)} />
          <ViewItem label="Email"           value={orDash(profile.email)} />
          <ViewItem label="Contact person"  value={orDash(profile.contactPerson)} />
        </div>}
        editContent={<div className="pp-edit-grid">
          <Field label="Restaurant name"><input className="pp-input" value={draft.restaurantName} onChange={e=>set("restaurantName",e.target.value)} /></Field>
          <Field label="Phone">         <input className="pp-input" value={draft.phone}           onChange={e=>set("phone",e.target.value)} /></Field>
          <Field label="Email">         <input className="pp-input" type="email" value={draft.email} onChange={e=>set("email",e.target.value)} /></Field>
          <Field label="Contact person"><input className="pp-input" value={draft.contactPerson}   onChange={e=>set("contactPerson",e.target.value)} /></Field>
        </div>}
      />

      {/* 2 — Logo */}
      <SectionCard icon="🖼" iconBg="rgba(59,130,246,0.15)" title="Restaurant logo"
        editing={editing.logo} onEdit={()=>startEdit("logo")} onCancel={()=>cancelEdit("logo")} onSave={()=>cancelEdit("logo")}
        viewContent={
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <div style={{ width:88, height:88, borderRadius:14, border:`1px solid ${BORDER}`,
              overflow:"hidden", background:SURFACE, display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:12, color:T3, flexShrink:0 }}>
              {logoSrc ? <img src={logoSrc} alt="logo" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "No logo"}
            </div>
            <div>
              <div style={{ fontSize:14, color:T2, fontWeight:500 }}>{logoSrc?"Logo uploaded":"No logo set"}</div>
              <div style={{ fontSize:12, color:T3, marginTop:3 }}>PNG, JPG or WebP · max 5MB</div>
            </div>
          </div>
        }
        editContent={
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <div style={{ width:88, height:88, borderRadius:14, border:`1px solid ${BORDER}`,
              overflow:"hidden", background:SURFACE, display:"flex", alignItems:"center",
              justifyContent:"center", fontSize:12, color:T3, flexShrink:0 }}>
              {logoSrc ? <img src={logoSrc} alt="logo" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "No logo"}
            </div>
            <div>
              <input type="file" accept="image/*" ref={logoFileRef} style={{ display:"none" }} onChange={handleLogoUpload} />
              <label className="pp-upload-lbl" onClick={()=>logoFileRef.current?.click()} style={{ cursor:"pointer" }}>
                {uploading?"Uploading…":"Upload new logo"}
              </label>
              <div style={{ fontSize:12, color:T3, marginTop:8 }}>Recommended: 400×400px</div>
            </div>
          </div>
        }
      />

      {/* 3 — Banners */}
      <div className="pp-card">
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:"rgba(59,130,246,0.15)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>🖼️</div>
          <span style={{ fontSize:15, fontWeight:600, color:T1 }}>Banners</span>
          <span style={{ fontSize:12, color:T3, marginLeft:"auto" }}>{profile.banners.length} banner{profile.banners.length!==1?"s":""}</span>
        </div>
        {profile.banners.length===0 ? (
          <div style={{ fontSize:13, color:T3, fontStyle:"italic", paddingBottom:12 }}>No banners yet</div>
        ) : profile.banners.map(banner=>(
          <div key={banner._id} className="pp-list-row">
            <img src={banner.imageUrl} alt="banner" className="pp-thumb" style={{ width:80, height:40 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:T2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {banner.link||<span style={{ color:T3, fontStyle:"italic" }}>No link</span>}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <span style={{ fontSize:11, color:T3 }}>{banner.active?"Active":"Off"}</span>
              <Toggle checked={banner.active} onChange={()=>handleToggleBanner(banner)} />
            </div>
            <button className="pp-icon-btn danger" onClick={()=>handleDeleteBanner(banner._id)}>🗑</button>
          </div>
        ))}
        <div className="pp-add-row">
          <input type="file" accept="image/*" ref={bannerFileRef} style={{ display:"none" }} onChange={e=>setBannerFile(e.target.files[0])} />
          <label className="pp-upload-lbl" onClick={()=>bannerFileRef.current?.click()} style={{ cursor:"pointer" }}>
            {bannerFile?`📎 ${bannerFile.name.slice(0,20)}…`:"Choose image"}
          </label>
          <input className="pp-input" style={{ flex:1, minWidth:140 }} value={bannerLink}
            onChange={e=>setBannerLink(e.target.value)} placeholder="Link URL (optional)" />
          <button className="pp-add-btn" onClick={handleAddBanner} disabled={bannerUploading||!bannerFile}>
            {bannerUploading?"Uploading…":"Add banner"}
          </button>
        </div>
      </div>

      {/* 4 — Printers */}
      <div className="pp-card">
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:"rgba(245,158,11,0.15)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>🖨️</div>
          <span style={{ fontSize:15, fontWeight:600, color:T1 }}>Printer IPs</span>
          <span style={{ fontSize:12, color:T3, marginLeft:"auto" }}>{profile.printerIps.length} printer{profile.printerIps.length!==1?"s":""}</span>
        </div>
        {profile.printerIps.length===0 ? (
          <div style={{ fontSize:13, color:T3, fontStyle:"italic", paddingBottom:12 }}>No printers configured</div>
        ) : profile.printerIps.map(printer=>(
          <div key={printer._id} className="pp-list-row">
            <div className="pp-status-dot" style={{ background:printer.active?"#22c55e":"#6b7280" }} />
            <div style={{ minWidth:90, fontSize:13, fontWeight:600, color:T1 }}>{printer.name}</div>
            <div style={{ flex:1, fontFamily:"'DM Mono',monospace", fontSize:13, color:T2 }}>{printer.ip}</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <span style={{ fontSize:11, color:T3 }}>{printer.active?"Active":"Off"}</span>
              <Toggle checked={printer.active} onChange={()=>handleTogglePrinter(printer)} />
            </div>
            <button className="pp-icon-btn danger" onClick={()=>handleDeletePrinter(printer._id)}>🗑</button>
          </div>
        ))}
        <div className="pp-add-row">
          <input className="pp-input" style={{ width:160, fontFamily:"'DM Mono',monospace" }}
            value={newPrinterIp} onChange={e=>setNewPrinterIp(e.target.value)} placeholder="192.168.1.100" />
          <input className="pp-input" style={{ flex:1, minWidth:120 }}
            value={newPrinterName} onChange={e=>setNewPrinterName(e.target.value)} placeholder="e.g. Kitchen" />
          <button className="pp-add-btn" onClick={handleAddPrinter} disabled={printerSaving||!newPrinterIp.trim()}>
            {printerSaving?"Adding…":"Add printer"}
          </button>
        </div>
      </div>

      {/* 5 — Address */}
      <SectionCard icon="📍" iconBg={GREEN_BG} title="Address & location"
        editing={editing.address} onEdit={()=>startEdit("address")} onCancel={()=>cancelEdit("address")} onSave={()=>saveSection("address")}
        viewContent={<div className="pp-view-grid">
          <ViewItem full label="Full address"  value={orDash(profile.address)} />
          <ViewItem      label="City"          value={orDash(profile.city)} />
          <ViewItem      label="Coordinates"   value={profile.latitude&&profile.longitude?`${profile.latitude}, ${profile.longitude}`:"—"} />
          <ViewItem      label="Dine-in range"  value={profile.dineInRange?`${profile.dineInRange} m`:"—"} />
          <ViewItem      label="Delivery range" value={profile.deliveryRange?`${profile.deliveryRange} m`:"—"} />
        </div>}
        editContent={<div>
          <div className="pp-edit-grid">
            <Field label="Full address" full><input className="pp-input" value={draft.address}      onChange={e=>set("address",e.target.value)} /></Field>
            <Field label="City">             <input className="pp-input" value={draft.city}         onChange={e=>set("city",e.target.value)} /></Field>
            <Field label="Dine-in range (m)"><input className="pp-input" type="number" value={draft.dineInRange}  onChange={e=>setNum("dineInRange",e.target.value)} /></Field>
            <Field label="Latitude">         <input className="pp-input" value={draft.latitude}     onChange={e=>set("latitude",e.target.value)} /></Field>
            <Field label="Longitude">        <input className="pp-input" value={draft.longitude}    onChange={e=>set("longitude",e.target.value)} /></Field>
            <Field label="Delivery range (m)"><input className="pp-input" type="number" value={draft.deliveryRange} onChange={e=>setNum("deliveryRange",e.target.value)} /></Field>
          </div>
          <button className="pp-loc-btn" onClick={getCurrentLocation}>📍 Use my current location</button>
        </div>}
      />

      {/* 6 — Business */}
      <SectionCard icon="📋" iconBg="rgba(245,158,11,0.15)" title="Business details"
        editing={editing.biz} onEdit={()=>startEdit("biz")} onCancel={()=>cancelEdit("biz")} onSave={()=>saveSection("biz")}
        viewContent={<div className="pp-view-grid">
          <ViewItem label="FSSAI number"      value={orDash(profile.fssaiNumber)} />
          <ViewItem label="GST number"        value={orDash(profile.gstNumber)} />
          <ViewItem full label="About"        value={orDash(profile.aboutRestaurant)} />
        </div>}
        editContent={<div className="pp-edit-grid">
          <Field label="FSSAI number"><input className="pp-input" value={draft.fssaiNumber}     onChange={e=>set("fssaiNumber",e.target.value)} /></Field>
          <Field label="GST number">  <input className="pp-input" value={draft.gstNumber}       onChange={e=>set("gstNumber",e.target.value)} /></Field>
          <Field label="About" full>  <textarea className="pp-textarea" value={draft.aboutRestaurant} onChange={e=>set("aboutRestaurant",e.target.value)} /></Field>
        </div>}
      />

      {/* 7 — Hours */}
      <SectionCard icon="🕐" iconBg="rgba(59,130,246,0.15)" title="Operating hours"
        editing={editing.hours} onEdit={()=>startEdit("hours")} onCancel={()=>cancelEdit("hours")} onSave={()=>saveSection("hours")}
        viewContent={<div className="pp-view-grid cols3">
          <ViewItem label="Opens"             value={fmt12(profile.openingTime)} />
          <ViewItem label="Closes"            value={fmt12(profile.closingTime)} />
          <ViewItem label="Avg delivery time" value={profile.avgDeliveryTime?`${profile.avgDeliveryTime} min`:"—"} />
        </div>}
        editContent={<div className="pp-edit-grid" style={{ gridTemplateColumns:"1fr 1fr 1fr" }}>
          <Field label="Opening time">    <input className="pp-input" type="time"   value={draft.openingTime}    onChange={e=>set("openingTime",e.target.value)} /></Field>
          <Field label="Closing time">    <input className="pp-input" type="time"   value={draft.closingTime}    onChange={e=>set("closingTime",e.target.value)} /></Field>
          <Field label="Avg delivery (mins)"><input className="pp-input" type="number" value={draft.avgDeliveryTime} onChange={e=>setNum("avgDeliveryTime",e.target.value)} /></Field>
        </div>}
      />

      {/* 8 — Pricing */}
      <SectionCard icon="₹" iconBg={GREEN_BG} title="Pricing & charges"
        editing={editing.pricing} onEdit={()=>startEdit("pricing")} onCancel={()=>cancelEdit("pricing")} onSave={()=>saveSection("pricing")}
        viewContent={<div className="pp-view-grid">
          <ViewItem label="GST Rate"       value={`${profile.gstRate??0}%`} />
          <ViewItem label="Service Charge" value={profile.serviceCharge>0?`₹${profile.serviceCharge} per item`:"Not set"} />
        </div>}
        editContent={<div className="pp-edit-grid">
          <Field label="GST Rate (%)">              <input className="pp-input" type="number" value={draft.gstRate}       onChange={e=>setNum("gstRate",e.target.value)} /></Field>
          <Field label="Service Charge (₹/item)">  <input className="pp-input" type="number" value={draft.serviceCharge} onChange={e=>setNum("serviceCharge",e.target.value)} /></Field>
        </div>}
      />

      {/* 8b — Payment (UPI) */}
      <SectionCard icon="📲" iconBg={GREEN_BG} title="Payment — UPI"
        editing={editing.payment} onEdit={()=>startEdit("payment")} onCancel={()=>cancelEdit("payment")} onSave={()=>saveSection("payment")}
        viewContent={<div className="pp-view-grid">
          <ViewItem label="Restaurant UPI ID" value={profile.upiId || "Not set — customers won't see the online payment option"} />
          <ViewItem label="Payee name shown in customer's UPI app" value={profile.upiPayeeName || profile.restaurantName || "—"} />
        </div>}
        editContent={<div className="pp-edit-grid">
          <Field label="Restaurant UPI ID">
            <input className="pp-input" placeholder="restaurantname@okhdfcbank" value={draft.upiId} onChange={e=>set("upiId",e.target.value)} />
          </Field>
          <Field label="Payee name (optional — defaults to restaurant name)">
            <input className="pp-input" placeholder={draft.restaurantName || "Restaurant"} value={draft.upiPayeeName} onChange={e=>set("upiPayeeName",e.target.value)} />
          </Field>
        </div>}
      />

      {/* 9 — Social */}
      <SectionCard icon="🔗" iconBg={PINK_BG} title="Social media & website"
        editing={editing.social} onEdit={()=>startEdit("social")} onCancel={()=>cancelEdit("social")} onSave={()=>saveSection("social")}
        viewContent={<div className="pp-view-grid">
          <ViewItem label="Instagram" value={profile.socialInstagram||null} />
          <ViewItem label="Facebook"  value={profile.socialFacebook||null} />
          <ViewItem full label="Website" value={profile.website||null} />
        </div>}
        editContent={<div className="pp-edit-grid">
          <Field label="Instagram URL"><input className="pp-input" value={draft.socialInstagram} placeholder="https://instagram.com/…" onChange={e=>set("socialInstagram",e.target.value)} /></Field>
          <Field label="Facebook URL"> <input className="pp-input" value={draft.socialFacebook}  placeholder="https://facebook.com/…"  onChange={e=>set("socialFacebook",e.target.value)} /></Field>
          <Field label="Website" full> <input className="pp-input" value={draft.website}         placeholder="https://yourwebsite.com"  onChange={e=>set("website",e.target.value)} /></Field>
        </div>}
      />

      {/* 10 — Services */}
      <SectionCard icon="✅" iconBg="rgba(16,185,129,0.15)" title="Services & preferences"
        editing={editing.services} onEdit={()=>startEdit("services")} onCancel={()=>cancelEdit("services")} onSave={()=>saveSection("services")}
        viewContent={<div>
          <div className="pp-label" style={{ marginBottom:10 }}>Services offered</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
            {[{ key:"dineIn",label:"Dine-in"},{ key:"takeAway",label:"Take away"},{ key:"delivery",label:"Delivery"}].map(({key,label})=>(
              <span key={key} className={`pp-badge${profile.services[key]?" on":""}`}>{label}</span>
            ))}
          </div>
          <div style={{ borderTop:`1px solid ${BORDER}`, paddingTop:14, fontSize:14, color:T2,
            display:"flex", alignItems:"center", gap:8 }}>
            <span>{profile.notificationSound?"🔔":"🔕"}</span>
            <span>{profile.notificationSound?"Notification sound on":"Notification sound off"}</span>
          </div>
        </div>}
        editContent={<div>
          <div className="pp-label" style={{ marginBottom:10 }}>Services offered</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:20 }}>
            {[{ key:"dineIn",label:"Dine-in"},{ key:"takeAway",label:"Take away"},{ key:"delivery",label:"Delivery"}].map(({key,label})=>(
              <div key={key} className={`pp-chip${draft.services[key]?" on":""}`} onClick={()=>setService(key)}>
                {draft.services[key]?"✓ ":""}{label}
              </div>
            ))}
          </div>
          <div style={{ borderTop:`1px solid ${BORDER}`, paddingTop:14, display:"flex", alignItems:"center", gap:10 }}>
            <input type="checkbox" id="notif-chk" checked={draft.notificationSound}
              onChange={e=>set("notificationSound",e.target.checked)}
              style={{ accentColor:PINK, width:16, height:16, cursor:"pointer" }} />
            <label htmlFor="notif-chk" style={{ fontSize:14, color:T1, cursor:"pointer" }}>
              Enable notification sound
            </label>
          </div>
        </div>}
      />

      <div style={{ textAlign:"center", paddingTop:24 }}>
        <button className="pp-save-all" onClick={handleSaveAll} disabled={saving}>
          {saving?"Saving…":"Save all settings"}
        </button>
      </div>
    </div>
  );
}
