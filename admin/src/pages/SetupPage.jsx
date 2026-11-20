// src/pages/SetupPage.jsx — Offline Edition first-time setup (/setup).
// Used once, on a restaurant PC whose local database has no admin yet. The
// server prints a one-time setup code on its own console and accepts this
// form only from the PC itself (restaurant-server/routes/localAuthRoutes.js
// requireLoopback). It creates the restaurant profile, the first admin and
// their PIN, and makes THIS browser the first trusted device.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth.js";
import { saveDevice } from "../local/localAuth.js";
import { getSetupStatus, bootstrapRestaurant } from "../local/localAdminService.js";
import { t } from "../i18n/core.js";
import { PRIMARY } from "../theme.js";

const box = { background: "#13111f", borderRadius: 20, padding: "28px 26px", width: "100%", maxWidth: 520, border: "1px solid rgba(139,92,246,0.2)", boxShadow: "0 25px 60px rgba(0,0,0,0.6)", boxSizing: "border-box", color: "#f1f0f5" };
const input = { padding: "11px 13px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", fontSize: 14.5, width: "100%", boxSizing: "border-box", background: "#1a1625", color: "#f1f0f5", fontFamily: "inherit", outline: "none" };
const digits = (v, max) => v.replace(/\D/g, "").slice(0, max);

export default function SetupPage() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState("checking"); // checking | needed | done | error
  const [f, setF] = useState({ setupCode: "", siteId: "", rName: "", rPhone: "", rAddress: "", aName: "", aPhone: "", pin: "", pin2: "", device: t("Counter PC") });
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    getSetupStatus()
      .then(({ data }) => setStatus(data.needsBootstrap ? "needed" : "done"))
      .catch(() => setStatus("error"));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const local = [];
    if (f.setupCode.replace(/[\s-]/g, "").length !== 12) local.push(t("Type the 12-character setup code from the server window"));
    if (f.aPhone.length !== 10) local.push(t("Enter the admin's 10-digit mobile number"));
    if (f.pin.length < 6) local.push(t("PIN must be 6–8 digits"));
    else if (f.pin !== f.pin2) local.push(t("The two PINs don't match"));
    setProblems(local);
    if (local.length) return;
    setBusy(true);
    try {
      const { data } = await bootstrapRestaurant({
        setupCode: f.setupCode, siteId: f.siteId.trim().toLowerCase(),
        restaurant: { name: f.rName, phone: f.rPhone, address: f.rAddress },
        admin: { name: f.aName, phone: f.aPhone, pin: f.pin },
        device: { label: f.device, platform: String(navigator.userAgent || "").slice(0, 200) },
      });
      saveDevice({ ...data.device, label: f.device });
      login(data.session);
      toast.success(t("Restaurant set up — welcome, {name}!", { name: data.session.name }));
      nav("/admin", { replace: true });
    } catch (err) {
      const d = err.response?.data;
      if (d?.code === "ALREADY_BOOTSTRAPPED") setStatus("done");
      setProblems(d?.problems?.length ? d.problems : [d?.message || t("Can't reach the restaurant server")]);
    } finally { setBusy(false); }
  };

  const field = (label, k, props = {}) => (
    <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600, color: "#9ca3af" }}>
      {label}
      <input value={f[k]} onChange={props.onChange || set(k)} style={{ ...input, ...(props.style || {}) }} {...props.input} />
    </label>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f0d18 0%, #1a1625 50%, #12101a 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'DM Sans', 'Noto Sans Bengali', sans-serif" }}>
      <div style={box}>
        <div style={{ fontWeight: 800, fontSize: 21, marginBottom: 4 }}>{t("First-time setup")}</div>
        <div style={{ fontSize: 12.5, color: "#9ca3af", lineHeight: 1.5, marginBottom: 18 }}>
          {t("This restaurant PC has no admin yet. Do this once, on this PC. The setup code is shown in the Zen OS server window.")}
        </div>

        {status === "checking" && <div style={{ color: "#9ca3af" }}>{t("Please wait…")}</div>}
        {status === "error" && <div role="alert" style={{ color: "#fca5a5" }}>{t("Can't reach the restaurant server. Is the Zen OS server running on this PC?")}</div>}
        {status === "done" && (
          <div>
            <div style={{ color: "#9ca3af", marginBottom: 14 }}>{t("This restaurant is already set up.")}</div>
            <button type="button" onClick={() => nav("/login", { replace: true })} style={{ ...input, background: PRIMARY, border: "none", fontWeight: 800, cursor: "pointer" }}>{t("Go to sign in")}</button>
          </div>
        )}

        {status === "needed" && (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {field(t("Setup code"), "setupCode", { onChange: (e) => setF((s) => ({ ...s, setupCode: e.target.value.toUpperCase().slice(0, 14) })), style: { letterSpacing: 2, fontWeight: 700 }, input: { placeholder: "ABCD-EFGH-JKLM", autoComplete: "off", autoFocus: true } })}
              {field(t("Restaurant ID"), "siteId", { input: { placeholder: "adds-cafe", autoComplete: "off" } })}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: -6 }}>{t("Restaurant ID = LOCAL_SITE_ID in this PC's .env file.")}</div>

            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#c4b5fd", marginTop: 6 }}>{t("RESTAURANT")}</div>
            {field(t("Restaurant name"), "rName")}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {field(t("Restaurant phone (optional)"), "rPhone", { onChange: (e) => setF((s) => ({ ...s, rPhone: digits(e.target.value, 15) })), input: { inputMode: "numeric" } })}
              {field(t("Address (optional)"), "rAddress")}
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#c4b5fd", marginTop: 6 }}>{t("FIRST ADMIN")}</div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {field(t("Name"), "aName")}
              {field(t("Mobile number"), "aPhone", { onChange: (e) => setF((s) => ({ ...s, aPhone: digits(e.target.value, 10) })), input: { inputMode: "numeric", placeholder: "98765 43210" } })}
              {field(t("PIN (6–8 digits)"), "pin", { onChange: (e) => setF((s) => ({ ...s, pin: digits(e.target.value, 8) })), style: { letterSpacing: 4 }, input: { type: "password", inputMode: "numeric", autoComplete: "new-password" } })}
              {field(t("PIN again"), "pin2", { onChange: (e) => setF((s) => ({ ...s, pin2: digits(e.target.value, 8) })), style: { letterSpacing: 4 }, input: { type: "password", inputMode: "numeric", autoComplete: "new-password" } })}
            </div>
            {field(t("Name of this PC"), "device")}

            {problems.length > 0 && (
              <ul role="alert" style={{ margin: 0, padding: "10px 14px 10px 28px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, color: "#fca5a5", fontSize: 12.5, lineHeight: 1.5 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <button type="submit" disabled={busy} style={{ padding: 14, borderRadius: 12, border: "none", background: PRIMARY, color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "inherit" }}>
              {busy ? t("Please wait…") : t("Set up the restaurant")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
