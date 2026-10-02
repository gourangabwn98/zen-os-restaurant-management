// src/pages/admin/ProfilePage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Zen OS "Restaurant profile" — migrated to the shared design system
// (design-reference/zen-os-design-reference.html → "Profile" screen) to match
// Invoices / Users / Insights: zc-card sections with a title/subtitle/Edit
// button header, zc-input/zc-btn controls, and the reference's two-column
// kv() layout for view mode.
//
// This is the one already-real page in the set — nothing here was fabricated,
// so the migration is visual only. All state, handlers and endpoints are
// UNCHANGED from the previous build:
//   • load/save   = GET/PUT /admin/restaurant/profile
//   • logo        = POST /admin/restaurant/logo
//   • banners     = POST/PATCH/DELETE /admin/restaurant/banner[/:id]
//   • printers    = POST/PATCH/DELETE /admin/restaurant/printer[/:id]
// The reference mockup only shows 6 of this restaurant's real settings
// (Identity, Payment, Service, Printers, Banners, Links) — every other real
// field (address/location, business/FSSAI, hours, pricing & delivery
// charges, social) is kept, styled the same way, rather than dropped to
// match the mockup's abbreviated scope.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import {
  getRestaurantProfile, updateRestaurantProfile, uploadRestaurantLogo, uploadPaymentQr, removePaymentQr,
  uploadRestaurantBanner, updateRestaurantBanner, deleteRestaurantBanner,
  addRestaurantPrinter, updateRestaurantPrinter, deleteRestaurantPrinter,
} from "../../services/adminService.js";
import PageHeader from "./shared/PageHeader.jsx";
import { t, tn, N_, fmtNum } from "../../i18n/core.js";
import { invalidate } from "../../services/cache.js";

// ── page-scoped styles (tokens only — light / dark safe) ─────────────────────
if (typeof document !== "undefined" && !document.getElementById("prof-styles")) {
  const s = document.createElement("style");
  s.id = "prof-styles";
  s.textContent = `
    .prof-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .prof-grid { grid-template-columns: 1fr; } }
    .prof-kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .prof-kv .full { grid-column: 1 / -1; }
    .prof-kv .k { font-size: 10.5px; color: var(--text-3); margin-bottom: 4px; }
    .prof-kv .v { font-size: 12.5px; font-weight: 500; color: var(--text-1); word-break: break-word; }
    .prof-kv .v.empty { color: var(--text-3); font-style: italic; font-weight: 400; }
    .prof-edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .prof-edit-grid .full { grid-column: 1 / -1; }
    .prof-field label { display: block; font-size: 11.5px; color: var(--text-2); font-weight: 500; margin-bottom: 6px; }
    .prof-toggle { width: 32px; height: 18px; border-radius: 20px; flex: none; position: relative; cursor: pointer; border: none; padding: 0; }
    .prof-toggle i { position: absolute; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .15s; }
    .prof-row {
      display: flex; align-items: center; gap: 11px; padding: 11px 13px; border-radius: var(--r-ctl);
      border: 1px solid var(--edge); background: var(--card-2); margin-bottom: 9px;
    }
    .prof-row.on { border-color: var(--ready-line); background: var(--ready-fill); }
    .prof-list-row {
      display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--edge);
    }
    .prof-list-row:last-child { border-bottom: none; }
    .prof-thumb { object-fit: cover; border-radius: 7px; border: 1px solid var(--edge); flex: none; background: var(--card-2); }
    .prof-chip {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 15px; border-radius: 20px;
      border: 1px solid var(--edge); font-size: 12.5px; cursor: pointer; color: var(--text-2);
      background: var(--card-2); user-select: none;
    }
    .prof-chip.on { background: var(--violet-weak); border-color: var(--violet-mid); color: var(--accent-ink); font-weight: 500; }
    .prof-banner-tile {
      border-radius: 13px; height: 84px; position: relative; overflow: hidden; border: 1px solid var(--edge);
    }
    .prof-avatar {
      width: 82px; height: 82px; border-radius: 18px; flex: none; display: grid; place-items: center;
      font-size: 30px; font-weight: 800; color: #fff; background: var(--grad-btn);
      box-shadow: 0 14px 32px -12px var(--violet-glow); overflow: hidden;
    }
    .prof-avatar img { width: 100%; height: 100%; object-fit: cover; }
  `;
  document.head.appendChild(s);
}

const fmt12 = (hhmm) => {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? t("PM") : t("AM");
  const h12 = h % 12 || 12;
  return `${fmtNum(h12)}:${fmtNum(m, { minimumIntegerDigits: 2 })} ${ampm}`;
};
const orDash = (v) => (v && String(v).trim() ? v : "—");

// ── shared bits ────────────────────────────────────────────────────────────
const SectionCard = ({ title, sub, editing, onEdit, onSave, onCancel, viewContent, editContent }) => (
  <div className="zc-card" style={{ marginBottom: 16 }}>
    <div className="zc-card-h">
      <div><div className="t">{title}</div><div className="s">{sub}</div></div>
      <div style={{ flex: 1 }} />
      {editing ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="zc-btn sm" onClick={onCancel}>{t("Cancel")}</button>
          <button type="button" className="zc-btn pri sm" onClick={onSave}>{t("Save")}</button>
        </div>
      ) : (
        <button type="button" className="zc-btn sm" onClick={onEdit}>{t("Edit")}</button>
      )}
    </div>
    <div style={{ padding: 18 }}>{editing ? editContent : viewContent}</div>
  </div>
);

const Kv = ({ pairs }) => (
  <div className="prof-kv">
    {pairs.map(([k, v, full]) => (
      <div key={k} className={full ? "full" : undefined}>
        <div className="k">{k}</div>
        <div className={`v${!v || v === "—" ? " empty" : ""}`}>{v || "—"}</div>
      </div>
    ))}
  </div>
);

const Field = ({ label, children, full }) => (
  <div className={`prof-field${full ? " full" : ""}`}>
    <label>{label}</label>
    {children}
  </div>
);

const Toggle = ({ on, onClick, disabled }) => (
  <button type="button" className="prof-toggle" disabled={disabled} onClick={onClick}
    style={{ background: on ? "var(--ready)" : "var(--raise)", boxShadow: on ? "0 0 12px -2px var(--ready)" : "none" }}>
    <i style={{ left: on ? 16 : 2 }} />
  </button>
);

const ServiceRow = ({ label, on, editable, onClick }) => (
  <div className={`prof-row${on ? " on" : ""}`} style={editable ? { cursor: "pointer" } : undefined} onClick={editable ? onClick : undefined}>
    <Toggle on={on} onClick={editable ? onClick : undefined} disabled={!editable} />
    <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>{label}</span>
    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{on ? t("Accepting orders") : t("Turned off")}</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// RestaurantProfile.paymentMode (restaurant-server/utils/paymentMode.js)
const PAYMENT_MODE_META = {
  CASH:   { icon: "💵", label: N_("Cash only"),
            help: N_("Customers order directly and pay at the table or counter. They're shown how to use “Call waiter” to pay.") },
  ONLINE: { icon: "📲", label: N_("Online only (pay before ordering)"),
            help: N_("Customers pay with PhonePe first. The order reaches waiters and the kitchen only after the payment is verified; unpaid orders cancel after 15 min.") },
  BOTH:   { icon: "🔀", label: N_("Cash or online — customer chooses"),
            help: N_("Customers pick at checkout. Choosing online works like “Online only” (pay first, then the order is sent).") },
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function ProfilePage() {
  const DEFAULTS = {
    restaurantName: "", phone: "", email: "", contactPerson: "", logo: "",
    address: "", city: "", latitude: "", longitude: "",
    dineInRange: 50, deliveryRange: 5000,
    fssaiNumber: "", gstNumber: "", aboutRestaurant: "", gstRate: 0,
    openingTime: "09:00", closingTime: "22:00", avgDeliveryTime: 30,
    minOrderAmount: 0, freeDeliveryAbove: 300, deliveryBaseFee: 40,
    deliveryFeePerKm: 8, serviceCharge: 0, packingCharge: 0,
    socialInstagram: "", socialFacebook: "", website: "",
    services: { dineIn: true, takeAway: true, delivery: true },
    notificationSound: true, banners: [], printerIps: [], editWindowMinutes: 3,
    upiId: "", upiPayeeName: "", paymentMode: "BOTH",
  };

  const [profile, setProfile] = useState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [editing, setEditing] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerLink, setBannerLink] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [newPrinterIp, setNewPrinterIp] = useState("");
  const [newPrinterName, setNewPrinterName] = useState("");
  const [printerSaving, setPrinterSaving] = useState(false);
  const [qrUploading, setQrUploading] = useState(false);
  const logoFileRef = useRef();
  const qrFileRef = useRef();
  const bannerFileRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const res = await getRestaurantProfile();
        if (res?.data?.data) {
          const d = res.data.data;
          const merged = {
            ...DEFAULTS, ...d,
            services: { ...DEFAULTS.services, ...(d.services || {}) },
            banners: d.banners || [],
            printerIps: d.printerIps || [],
          };
          setProfile(merged); setDraft(merged);
        }
      } catch { toast.error(t("Failed to load profile")); }
      finally { setLoading(false); }
    })();
  }, []);

  const startEdit = (sec) => { setDraft({ ...profile }); setEditing((p) => ({ ...p, [sec]: true })); };
  const cancelEdit = (sec) => { setEditing((p) => ({ ...p, [sec]: false })); };

  const sectionFields = (sec) => {
    const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, draft[k]]));
    switch (sec) {
      case "basic": return pick("restaurantName", "phone", "email", "contactPerson");
      case "address": return pick("address", "city", "latitude", "longitude", "dineInRange", "deliveryRange");
      case "biz": return pick("fssaiNumber", "gstNumber", "aboutRestaurant");
      case "hours": return pick("openingTime", "closingTime", "avgDeliveryTime");
      case "pricing": return pick("minOrderAmount", "freeDeliveryAbove", "deliveryBaseFee", "deliveryFeePerKm", "serviceCharge", "packingCharge", "gstRate");
      case "payment": return pick("upiId", "upiPayeeName", "paymentMode");
      case "social": return pick("socialInstagram", "socialFacebook", "website");
      case "services": return pick("services", "notificationSound", "editWindowMinutes");
      default: return {};
    }
  };

  const saveSection = async (sec) => {
    try {
      const updated = { ...profile, ...sectionFields(sec) };
      if (sec === "services" && (updated.editWindowMinutes === "" || updated.editWindowMinutes == null)) {
        toast.error(t("Enter the minutes a Placed order can be changed (0 = start preparing immediately)"));
        return;
      }
      if (sec === "payment" && updated.upiId) {
        const upiPattern = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiPattern.test(updated.upiId.trim())) {
          toast.error(t("Enter a valid UPI ID, e.g. restaurantname@okhdfcbank"));
          return;
        }
        updated.upiId = updated.upiId.trim();
      }
      const before = profile;
      setProfile(updated); setEditing((p) => ({ ...p, [sec]: false }));
      try {
        await updateRestaurantProfile(updated);
        invalidate("order:profile"); // GST / service charge feed order totals
        toast.success(t("Section saved"));
      } catch (err) {
        // Roll back and reopen the section, with the server's reason
        // (e.g. "Online only" needs PhonePe configured).
        setProfile(before); setDraft(updated); setEditing((p) => ({ ...p, [sec]: true }));
        toast.error(err?.response?.data?.message || t("Failed to save"));
      }
    } catch { toast.error(t("Failed to save")); }
  };

  const set = (k, v) => setDraft((p) => ({ ...p, [k]: v }));
  const setNum = (k, v) => setDraft((p) => ({ ...p, [k]: Number(v) }));
  const setService = (svc) => setDraft((p) => ({ ...p, services: { ...p.services, [svc]: !p.services[svc] } }));

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setLogoPreview(URL.createObjectURL(file)); setUploading(true);
    const fd = new FormData(); fd.append("logo", file);
    try {
      const res = await uploadRestaurantLogo(fd);
      const url = res?.data?.logoUrl;
      setProfile((p) => ({ ...p, logo: url })); setDraft((p) => ({ ...p, logo: url }));
      toast.success(t("Logo uploaded"));
    } catch { toast.error(t("Failed to upload logo")); setLogoPreview(""); }
    finally { setUploading(false); }
  };

  const handlePaymentQrUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setQrUploading(true);
    const fd = new FormData(); fd.append("paymentQr", file);
    try {
      const res = await uploadPaymentQr(fd);
      const url = res?.data?.paymentQr || "";
      setProfile((p) => ({ ...p, paymentQr: url })); setDraft((p) => ({ ...p, paymentQr: url }));
      toast.success(t("Payment QR uploaded"));
    } catch (err) { toast.error(err?.response?.data?.message || t("Failed to upload payment QR")); }
    finally { setQrUploading(false); if (qrFileRef.current) qrFileRef.current.value = ""; }
  };

  const handlePaymentQrRemove = async () => {
    if (!window.confirm(t("Remove the payment QR from bills?"))) return;
    try {
      await removePaymentQr();
      setProfile((p) => ({ ...p, paymentQr: "" })); setDraft((p) => ({ ...p, paymentQr: "" }));
      toast.success(t("Payment QR removed"));
    } catch { toast.error(t("Failed to remove payment QR")); }
  };

  // Uploads immediately (like the logo) — shown in both view and edit mode.
  const paymentQrBlock = (
    <div style={{ marginTop: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
      padding: "12px 14px", borderRadius: "var(--r-ctl)", border: "1px solid var(--edge)", background: "var(--card-2)" }}>
      {profile.paymentQr
        ? <img src={profile.paymentQr} alt={t("Payment QR")} style={{ width: 110, height: 110, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 4 }} />
        : <div style={{ width: 110, height: 110, display: "grid", placeItems: "center", borderRadius: 8, border: "2px dashed var(--edge)", color: "var(--text-3)", fontSize: 11, textAlign: "center" }}>{t("No QR yet")}</div>}
      <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 180 }}>
        <b style={{ fontSize: 13, color: "var(--text-1)" }}>{t("Payment QR on bills")}</b>
        <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{t("Upload your UPI / bank QR image. It's shown on the waiter and admin bill so customers can scan and pay. Staff still mark the order paid.")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={qrFileRef} type="file" accept="image/*" hidden onChange={handlePaymentQrUpload} />
          <button type="button" className="zc-btn sm" disabled={qrUploading} onClick={() => qrFileRef.current?.click()}>
            {qrUploading ? t("Uploading…") : profile.paymentQr ? t("Replace QR") : t("Upload QR")}
          </button>
          {profile.paymentQr && <button type="button" className="zc-btn sm danger" onClick={handlePaymentQrRemove}>{t("Remove")}</button>}
        </div>
      </div>
    </div>
  );

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return toast.error(t("Geolocation not supported"));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setDraft((p) => ({ ...p, latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) })); toast.success(t("Location fetched")); },
      () => toast.error(t("Could not get location")),
    );
  };

  const handleAddBanner = async () => {
    if (!bannerFile) return toast.error(t("Please select an image"));
    setBannerUploading(true);
    try {
      const fd = new FormData(); fd.append("banner", bannerFile);
      if (bannerLink) fd.append("link", bannerLink); fd.append("active", "true");
      const res = await uploadRestaurantBanner(fd);
      const upd = res?.data?.data;
      if (upd) { setProfile((p) => ({ ...p, banners: upd.banners })); setDraft((p) => ({ ...p, banners: upd.banners })); }
      setBannerFile(null); setBannerLink("");
      if (bannerFileRef.current) bannerFileRef.current.value = "";
      toast.success(t("Banner added"));
    } catch { toast.error(t("Failed to upload banner")); }
    finally { setBannerUploading(false); }
  };

  const handleToggleBanner = async (banner) => {
    const optimistic = profile.banners.map((b) => (b._id === banner._id ? { ...b, active: !b.active } : b));
    setProfile((p) => ({ ...p, banners: optimistic }));
    try { await updateRestaurantBanner(banner._id, { active: !banner.active }); }
    catch { toast.error(t("Failed")); setProfile((p) => ({ ...p, banners: profile.banners })); }
  };

  const handleDeleteBanner = async (id) => {
    if (!window.confirm(t("Delete this banner?"))) return;
    try {
      const res = await deleteRestaurantBanner(id); const upd = res?.data?.data;
      if (upd) { setProfile((p) => ({ ...p, banners: upd.banners })); setDraft((p) => ({ ...p, banners: upd.banners })); }
      toast.success(t("Banner deleted"));
    } catch { toast.error(t("Failed")); }
  };

  const handleAddPrinter = async () => {
    if (!newPrinterIp.trim()) return toast.error(t("Enter an IP address"));
    setPrinterSaving(true);
    try {
      const res = await addRestaurantPrinter({ ip: newPrinterIp.trim(), name: newPrinterName.trim() || "Printer", active: true });
      const upd = res?.data?.data;
      if (upd) { setProfile((p) => ({ ...p, printerIps: upd.printerIps })); setDraft((p) => ({ ...p, printerIps: upd.printerIps })); }
      setNewPrinterIp(""); setNewPrinterName(""); toast.success(t("Printer added"));
    } catch { toast.error(t("Failed")); }
    finally { setPrinterSaving(false); }
  };

  const handleTogglePrinter = async (printer) => {
    const optimistic = profile.printerIps.map((p) => (p._id === printer._id ? { ...p, active: !p.active } : p));
    setProfile((p) => ({ ...p, printerIps: optimistic }));
    try { await updateRestaurantPrinter(printer._id, { active: !printer.active }); }
    catch { toast.error(t("Failed")); setProfile((p) => ({ ...p, printerIps: profile.printerIps })); }
  };

  const handleDeletePrinter = async (id) => {
    if (!window.confirm(t("Remove this printer?"))) return;
    try {
      const res = await deleteRestaurantPrinter(id); const upd = res?.data?.data;
      if (upd) { setProfile((p) => ({ ...p, printerIps: upd.printerIps })); setDraft((p) => ({ ...p, printerIps: upd.printerIps })); }
      toast.success(t("Printer removed"));
    } catch { toast.error(t("Failed")); }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try { await updateRestaurantProfile(profile); invalidate("order:profile"); toast.success(t("All settings saved!")); }
    catch { toast.error(t("Failed to save")); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title={t("Restaurant profile")} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "80px 0", color: "var(--text-3)" }}>
          <div className="zc-spin" />
          <div style={{ fontSize: 13 }}>{t("Loading profile…")}</div>
        </div>
      </div>
    );
  }

  const logoSrc = logoPreview || profile.logo;
  const services = [
    { key: "dineIn", label: t("Dine-in") },
    { key: "takeAway", label: t("Takeaway") },
    { key: "delivery", label: t("Delivery") },
  ];

  return (
    <div>
      <PageHeader title={t("Restaurant profile")} sub={t("Everything here is restaurant data, stored in the database — an admin can change it without a redeploy")} />

      <div className="prof-grid">
        {/* ── LEFT ── */}
        <div>
          {/* Identity */}
          <SectionCard title={t("Identity")} sub={t("Shown on the customer site, bills and KOT headers")}
            editing={editing.basic} onEdit={() => startEdit("basic")} onCancel={() => cancelEdit("basic")} onSave={() => saveSection("basic")}
            viewContent={<div style={{ display: "flex", gap: 16 }}>
              <div className="prof-avatar">{logoSrc ? <img src={logoSrc} alt={t("Logo")} /> : (profile.restaurantName?.[0] || "R")}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Kv pairs={[
                  [t("Restaurant name"), orDash(profile.restaurantName), true],
                  [t("Phone"), orDash(profile.phone)],
                  [t("Email"), orDash(profile.email)],
                  [t("Contact person"), orDash(profile.contactPerson)],
                ]} />
              </div>
            </div>}
            editContent={<div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div className="prof-avatar">{logoSrc ? <img src={logoSrc} alt={t("Logo")} /> : (draft.restaurantName?.[0] || "R")}</div>
                <div>
                  <input type="file" accept="image/*" ref={logoFileRef} style={{ display: "none" }} onChange={handleLogoUpload} />
                  <button type="button" className="zc-btn sm" onClick={() => logoFileRef.current?.click()}>{uploading ? t("Uploading…") : t("Change logo")}</button>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>{t("Recommended: 400×400px, max 5MB")}</div>
                </div>
              </div>
              <div className="prof-edit-grid">
                <Field label={t("Restaurant name")} full><input className="zc-input" value={draft.restaurantName} onChange={(e) => set("restaurantName", e.target.value)} /></Field>
                <Field label={t("Phone")}><input className="zc-input" value={draft.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
                <Field label={t("Email")}><input className="zc-input" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} /></Field>
                <Field label={t("Contact person")} full><input className="zc-input" value={draft.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></Field>
              </div>
            </div>}
          />

          {/* Address & location */}
          <SectionCard title={t("Address & location")} sub={t("Used to check whether a customer's table QR / delivery point is in range")}
            editing={editing.address} onEdit={() => startEdit("address")} onCancel={() => cancelEdit("address")} onSave={() => saveSection("address")}
            viewContent={<Kv pairs={[
              [t("Full address"), orDash(profile.address), true],
              [t("City"), orDash(profile.city)],
              [t("Coordinates"), profile.latitude && profile.longitude ? `${profile.latitude}, ${profile.longitude}` : "—"],
              [t("Dine-in range"), profile.dineInRange ? `${fmtNum(profile.dineInRange)} ${t("m")}` : "—"],
              [t("Delivery range"), profile.deliveryRange ? `${fmtNum(profile.deliveryRange)} ${t("m")}` : "—"],
            ]} />}
            editContent={<div>
              <div className="prof-edit-grid" style={{ marginBottom: 12 }}>
                <Field label={t("Full address")} full><input className="zc-input" value={draft.address} onChange={(e) => set("address", e.target.value)} /></Field>
                <Field label={t("City")}><input className="zc-input" value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field>
                <Field label={t("Dine-in range (m)")}><input className="zc-input" type="number" value={draft.dineInRange} onChange={(e) => setNum("dineInRange", e.target.value)} /></Field>
                <Field label={t("Latitude")}><input className="zc-input" value={draft.latitude} onChange={(e) => set("latitude", e.target.value)} /></Field>
                <Field label={t("Longitude")}><input className="zc-input" value={draft.longitude} onChange={(e) => set("longitude", e.target.value)} /></Field>
                <Field label={t("Delivery range (m)")}><input className="zc-input" type="number" value={draft.deliveryRange} onChange={(e) => setNum("deliveryRange", e.target.value)} /></Field>
              </div>
              <button type="button" className="zc-btn sm" onClick={getCurrentLocation}>📍 {t("Use my current location")}</button>
            </div>}
          />

          {/* Business details */}
          <SectionCard title={t("Business details")} sub={t("Compliance numbers and the customer-facing description")}
            editing={editing.biz} onEdit={() => startEdit("biz")} onCancel={() => cancelEdit("biz")} onSave={() => saveSection("biz")}
            viewContent={<Kv pairs={[
              [t("FSSAI number"), orDash(profile.fssaiNumber)],
              [t("GST number"), orDash(profile.gstNumber)],
              [t("About"), orDash(profile.aboutRestaurant), true],
            ]} />}
            editContent={<div className="prof-edit-grid">
              <Field label={t("FSSAI number")}><input className="zc-input" value={draft.fssaiNumber} onChange={(e) => set("fssaiNumber", e.target.value)} /></Field>
              <Field label={t("GST number")}><input className="zc-input" value={draft.gstNumber} onChange={(e) => set("gstNumber", e.target.value)} /></Field>
              <Field label={t("About")} full><textarea className="zc-textarea" rows={3} value={draft.aboutRestaurant} onChange={(e) => set("aboutRestaurant", e.target.value)} /></Field>
            </div>}
          />

          {/* Payment — UPI + PhonePe */}
          <SectionCard title={t("Payment")} sub={t("PhonePe gateway + UPI deep-link fallback")}
            editing={editing.payment} onEdit={() => startEdit("payment")} onCancel={() => cancelEdit("payment")} onSave={() => saveSection("payment")}
            viewContent={<div>
              <Kv pairs={[
                [t("PhonePe gateway"), profile.phonePeEnabled
                  ? t("Active — customers pay online, orders auto-confirm as Paid on a verified PhonePe result")
                  : t("Off — set PHONEPE_MERCHANT_ID / PHONEPE_SALT_KEY in the backend .env to enable")],
                [t("Customers can pay"), t(PAYMENT_MODE_META[profile.paymentMode || "BOTH"].label)
                  + (profile.paymentMode === "ONLINE" && !profile.phonePeEnabled ? ` — ⚠ ${t("PhonePe is off, so customers are offered cash instead")}` : "")],
                [t("UPI ID (fallback)"), profile.upiId || t("Not set — used only when the PhonePe gateway is off")],
                [t("Payee name"), profile.upiPayeeName || profile.restaurantName || "—"],
              ]} />
              {paymentQrBlock}
              <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: "var(--r-ctl)", fontSize: 11.5, color: "var(--text-2)", background: "var(--wait-fill)", border: "1px solid var(--wait-line)" }}>
                {t("A UPI deep-link payment is never proof of payment — those orders stay at Pending verification until an admin or waiter confirms against the bank receipt. Only a checksum-verified PhonePe result marks an order Paid automatically.")}
              </div>
            </div>}
            editContent={<div className="prof-edit-grid">
              <Field label={t("How customers can pay")} full>
                <div role="radiogroup" aria-label="How customers can pay" style={{ display: "grid", gap: 8 }}>
                  {["CASH", "ONLINE", "BOTH"].map((m) => {
                    const meta = PAYMENT_MODE_META[m];
                    const blocked = m === "ONLINE" && !profile.phonePeEnabled;
                    const on = (draft.paymentMode || "BOTH") === m;
                    return (
                      <button key={m} type="button" role="radio" aria-checked={on} disabled={blocked}
                        onClick={() => set("paymentMode", m)}
                        style={{
                          display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", padding: "10px 12px",
                          borderRadius: "var(--r-ctl)", cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.55 : 1,
                          border: `1px solid ${on ? "var(--violet-line)" : "var(--edge)"}`,
                          background: on ? "var(--violet-faint)" : "var(--card-2)", color: "var(--text-1)", font: "inherit",
                        }}>
                        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.2 }}>{meta.icon}</span>
                        <span style={{ display: "grid", gap: 2 }}>
                          <b style={{ fontSize: 13 }}>{t(meta.label)}</b>
                          <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                            {blocked ? t("Needs the PhonePe gateway — set PHONEPE_MERCHANT_ID / PHONEPE_SALT_KEY in the backend .env first.") : t(meta.help)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label={t("Restaurant UPI ID")}><input className="zc-input" placeholder="restaurantname@okhdfcbank" value={draft.upiId} onChange={(e) => set("upiId", e.target.value)} /></Field>
              <Field label={t("Payee name (optional — defaults to restaurant name)")}><input className="zc-input" placeholder={draft.restaurantName || t("Restaurant")} value={draft.upiPayeeName} onChange={(e) => set("upiPayeeName", e.target.value)} /></Field>
              <div style={{ gridColumn: "1 / -1" }}>{paymentQrBlock}</div>
            </div>}
          />

          {/* Services & preferences */}
          <SectionCard title={t("Services & preferences")} sub={t("What customers can order and how")}
            editing={editing.services} onEdit={() => startEdit("services")} onCancel={() => cancelEdit("services")} onSave={() => saveSection("services")}
            viewContent={<div>
              {services.map((s) => <ServiceRow key={s.key} label={s.label} on={profile.services[s.key]} editable={false} />)}
              <div style={{ borderTop: "1px solid var(--edge)", marginTop: 6, paddingTop: 12, display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text-2)" }}>
                <span>{profile.notificationSound ? "🔔" : "🔕"}</span>
                <span>{profile.notificationSound ? t("Notification sound on") : t("Notification sound off")}</span>
              </div>
              <div style={{ borderTop: "1px solid var(--edge)", marginTop: 12, paddingTop: 12, display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text-2)" }}>
                <span>⏱️</span>
                <span>{Number(profile.editWindowMinutes) > 0
                  ? t("Placed orders can be changed for {n} min, then start preparing automatically (KOT prints)", { n: Number(profile.editWindowMinutes) })
                  : t("Placed orders start preparing immediately (no time to change them)")}</span>
              </div>
            </div>}
            editContent={<div>
              {services.map((s) => <ServiceRow key={s.key} label={s.label} on={draft.services[s.key]} editable onClick={() => setService(s.key)} />)}
              <div style={{ borderTop: "1px solid var(--edge)", marginTop: 6, paddingTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <Toggle on={draft.notificationSound} onClick={() => set("notificationSound", !draft.notificationSound)} />
                <span style={{ fontSize: 12.5, color: "var(--text-1)" }}>{t("Notification sound")}</span>
              </div>
              <div style={{ borderTop: "1px solid var(--edge)", marginTop: 12, paddingTop: 12 }}>
                <Field label={t("Minutes a Placed order can be changed before it starts preparing (0–15)")}>
                  <input className="zc-input" type="number" min={0} max={15} step={1} style={{ maxWidth: 120 }}
                    value={draft.editWindowMinutes}
                    onChange={(e) => set("editWindowMinutes", e.target.value === "" ? "" : Math.max(0, Math.min(15, Math.round(Number(e.target.value)))))} />
                </Field>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                  {t("Waiter/admin orders are Placed straight away; customer orders once a waiter or admin accepts them. While Placed, anyone can change the order; then it moves to Preparing and the KOT prints. 0 = immediately.")}
                </div>
              </div>
            </div>}
          />
        </div>

        {/* ── RIGHT ── */}
        <div>
          {/* Operating hours */}
          <SectionCard title={t("Operating hours")} sub={t("When the restaurant accepts orders")}
            editing={editing.hours} onEdit={() => startEdit("hours")} onCancel={() => cancelEdit("hours")} onSave={() => saveSection("hours")}
            viewContent={<Kv pairs={[
              [t("Opens"), fmt12(profile.openingTime)],
              [t("Closes"), fmt12(profile.closingTime)],
              [t("Avg delivery time"), profile.avgDeliveryTime ? t("{n} min", { n: profile.avgDeliveryTime }) : "—"],
            ]} />}
            editContent={<div className="prof-edit-grid">
              <Field label={t("Opening time")}><input className="zc-input" type="time" value={draft.openingTime} onChange={(e) => set("openingTime", e.target.value)} /></Field>
              <Field label={t("Closing time")}><input className="zc-input" type="time" value={draft.closingTime} onChange={(e) => set("closingTime", e.target.value)} /></Field>
              <Field label={t("Avg delivery time (min)")} full><input className="zc-input" type="number" value={draft.avgDeliveryTime} onChange={(e) => setNum("avgDeliveryTime", e.target.value)} /></Field>
            </div>}
          />

          {/* Pricing & charges */}
          <SectionCard title={t("Pricing & charges")} sub={t("Tax, service and delivery fees applied to every order")}
            editing={editing.pricing} onEdit={() => startEdit("pricing")} onCancel={() => cancelEdit("pricing")} onSave={() => saveSection("pricing")}
            viewContent={<Kv pairs={[
              [t("GST rate"), `${fmtNum(profile.gstRate ?? 0)}%`],
              [t("Service charge"), profile.serviceCharge > 0 ? `₹${fmtNum(profile.serviceCharge)}` : t("Not set")],
              [t("Packing charge"), profile.packingCharge > 0 ? `₹${fmtNum(profile.packingCharge)}` : t("Not set")],
              [t("Min order amount"), profile.minOrderAmount > 0 ? `₹${fmtNum(profile.minOrderAmount)}` : t("None")],
              [t("Free delivery above"), profile.freeDeliveryAbove > 0 ? `₹${fmtNum(profile.freeDeliveryAbove)}` : "—"],
              [t("Delivery base fee"), `₹${fmtNum(profile.deliveryBaseFee ?? 0)}`],
              [t("Delivery fee / km"), `₹${fmtNum(profile.deliveryFeePerKm ?? 0)}`, true],
            ]} />}
            editContent={<div className="prof-edit-grid">
              <Field label={t("GST rate (%)")}><input className="zc-input" type="number" value={draft.gstRate} onChange={(e) => setNum("gstRate", e.target.value)} /></Field>
              <Field label={t("Service charge (₹)")}><input className="zc-input" type="number" value={draft.serviceCharge} onChange={(e) => setNum("serviceCharge", e.target.value)} /></Field>
              <Field label={t("Packing charge (₹)")}><input className="zc-input" type="number" value={draft.packingCharge} onChange={(e) => setNum("packingCharge", e.target.value)} /></Field>
              <Field label={t("Min order amount (₹)")}><input className="zc-input" type="number" value={draft.minOrderAmount} onChange={(e) => setNum("minOrderAmount", e.target.value)} /></Field>
              <Field label={t("Free delivery above (₹)")}><input className="zc-input" type="number" value={draft.freeDeliveryAbove} onChange={(e) => setNum("freeDeliveryAbove", e.target.value)} /></Field>
              <Field label={t("Delivery base fee (₹)")}><input className="zc-input" type="number" value={draft.deliveryBaseFee} onChange={(e) => setNum("deliveryBaseFee", e.target.value)} /></Field>
              <Field label={t("Delivery fee per km (₹)")} full><input className="zc-input" type="number" value={draft.deliveryFeePerKm} onChange={(e) => setNum("deliveryFeePerKm", e.target.value)} /></Field>
            </div>}
          />

          {/* Printers */}
          <div className="zc-card" style={{ marginBottom: 16 }}>
            <div className="zc-card-h">
              <div><div className="t">{t("Printers")}</div><div className="s">{t("Local print service, discovered on the restaurant network")}</div></div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{tn(profile.printerIps.length, "{n} printer", "{n} printers")}</span>
            </div>
            <div style={{ padding: 18 }}>
              {profile.printerIps.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-3)", fontStyle: "italic", paddingBottom: 8 }}>{t("No printers configured")}</div>
              ) : profile.printerIps.map((printer) => (
                <div key={printer._id} className="prof-list-row">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: printer.active ? "var(--ready)" : "var(--text-3)" }} />
                  <div style={{ minWidth: 90, fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{printer.name}</div>
                  <div style={{ flex: 1, fontFamily: "monospace", fontSize: 12.5, color: "var(--text-2)" }}>{printer.ip}</div>
                  <span className={`zc-tag ${printer.active ? "ready" : "done"}`}><i />{printer.active ? t("Online") : t("Off")}</span>
                  <Toggle on={printer.active} onClick={() => handleTogglePrinter(printer)} />
                  <button type="button" className="zc-btn ghost sm" onClick={() => handleDeletePrinter(printer._id)} aria-label={t("Remove printer")}>🗑</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 9, marginTop: 12, flexWrap: "wrap" }}>
                <input className="zc-input" style={{ width: 160, fontFamily: "monospace" }} value={newPrinterIp} onChange={(e) => setNewPrinterIp(e.target.value)} placeholder="192.168.1.100" />
                <input className="zc-input" style={{ flex: 1, minWidth: 120 }} value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} placeholder={t("e.g. Kitchen")} />
                <button type="button" className="zc-btn pri sm" onClick={handleAddPrinter} disabled={printerSaving || !newPrinterIp.trim()}>
                  {printerSaving ? t("Adding…") : t("Add printer")}
                </button>
              </div>
            </div>
          </div>

          {/* Banners */}
          <div className="zc-card" style={{ marginBottom: 16 }}>
            <div className="zc-card-h">
              <div><div className="t">{t("Banners")}</div><div className="s">{t("Carousel on the customer home screen")}</div></div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{tn(profile.banners.length, "{n} banner", "{n} banners")}</span>
            </div>
            <div style={{ padding: 18 }}>
              {profile.banners.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-3)", fontStyle: "italic", paddingBottom: 8 }}>{t("No banners yet")}</div>
              ) : profile.banners.map((banner) => (
                <div key={banner._id} className="prof-list-row">
                  <img src={banner.imageUrl} alt={t("banner")} className="prof-thumb" style={{ width: 72, height: 38 }} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {banner.link || <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>{t("No link")}</span>}
                  </div>
                  <span className={`zc-tag ${banner.active ? "ready" : "done"}`}><i />{banner.active ? t("Active") : t("Off")}</span>
                  <Toggle on={banner.active} onClick={() => handleToggleBanner(banner)} />
                  <button type="button" className="zc-btn ghost sm" onClick={() => handleDeleteBanner(banner._id)} aria-label={t("Delete banner")}>🗑</button>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <input type="file" accept="image/*" ref={bannerFileRef} style={{ display: "none" }} onChange={(e) => setBannerFile(e.target.files[0])} />
                <button type="button" className="zc-btn sm" onClick={() => bannerFileRef.current?.click()}>
                  {bannerFile ? `📎 ${bannerFile.name.slice(0, 20)}…` : t("Choose image")}
                </button>
                <input className="zc-input" style={{ flex: 1, minWidth: 140 }} value={bannerLink} onChange={(e) => setBannerLink(e.target.value)} placeholder={t("Link URL (optional)")} />
                <button type="button" className="zc-btn pri sm" onClick={handleAddBanner} disabled={bannerUploading || !bannerFile}>
                  {bannerUploading ? t("Uploading…") : t("Add banner")}
                </button>
              </div>
            </div>
          </div>

          {/* Links */}
          <SectionCard title={t("Links")} sub={t("Shown in the footer of the customer site")}
            editing={editing.social} onEdit={() => startEdit("social")} onCancel={() => cancelEdit("social")} onSave={() => saveSection("social")}
            viewContent={<Kv pairs={[
              [t("Instagram"), profile.socialInstagram || "—"],
              [t("Facebook"), profile.socialFacebook || "—"],
              [t("Website"), profile.website || "—", true],
            ]} />}
            editContent={<div className="prof-edit-grid">
              <Field label={t("Instagram URL")}><input className="zc-input" placeholder="https://instagram.com/…" value={draft.socialInstagram} onChange={(e) => set("socialInstagram", e.target.value)} /></Field>
              <Field label={t("Facebook URL")}><input className="zc-input" placeholder="https://facebook.com/…" value={draft.socialFacebook} onChange={(e) => set("socialFacebook", e.target.value)} /></Field>
              <Field label={t("Website")} full><input className="zc-input" placeholder="https://yourwebsite.com" value={draft.website} onChange={(e) => set("website", e.target.value)} /></Field>
            </div>}
          />
        </div>
      </div>

      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <button type="button" className="zc-btn pri" style={{ padding: "12px 40px", borderRadius: 30, fontSize: 14 }} onClick={handleSaveAll} disabled={saving}>
          {saving ? t("Saving…") : t("Save all settings")}
        </button>
      </div>
    </div>
  );
}
