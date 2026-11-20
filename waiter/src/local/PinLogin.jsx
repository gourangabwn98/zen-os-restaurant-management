// src/local/PinLogin.jsx — Offline Edition sign-in screen (see localAuth.js).
// Steps: register this device → wait for the admin to approve the pairing
// code → phone + PIN → (first sign-in with a PIN someone else set) choose
// your own PIN. Same file in admin/, waiter/ and kitchen/; only the colours
// (the `theme` prop) and the i18n import differ.
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { t } from "../i18n/index.jsx";
import {
  loadDevice, saveDevice, forgetDevice, registerDevice, getDeviceStatus, pinLogin, changeOwnPin,
} from "./localAuth.js";

const PIN_MIN = 6, PIN_MAX = 8;
const POLL_MS = 4000;
const msg = (err, fallback) => err?.response?.data?.message || (err?.response ? fallback : t("Can't reach the restaurant server — check the Wi-Fi"));
const codeOf = (err) => err?.response?.data?.code;

/**
 * Props:
 *   title        — e.g. "Waiter login"
 *   defaultLabel — suggested device name, e.g. "Waiter phone"
 *   roles        — roles this app accepts (others are told to use the right app)
 *   onLoggedIn(data) — same session shape as the OTP login
 *   theme        — { accent, accentText, text, muted, faint, inputBg, border, cardBg }
 */
export default function PinLogin({ title, defaultLabel, roles, onLoggedIn, theme }) {
  const th = { accent: "#3B82F6", accentText: "#fff", text: "#fff", muted: "rgba(255,255,255,0.68)", faint: "rgba(255,255,255,0.5)", inputBg: "rgba(255,255,255,0.07)", border: "rgba(255,255,255,0.12)", cardBg: "rgba(255,255,255,0.04)", ...theme };
  const [device, setDevice] = useState(loadDevice);
  const [step, setStep] = useState(() => (loadDevice() ? "checking" : "register"));
  const [deviceNote, setDeviceNote] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [label, setLabel] = useState(defaultLabel || "");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef(null); // { data, pin } — signed in but must choose own PIN

  const startOver = (note = "") => { forgetDevice(); setDevice(null); setPairingCode(""); setDeviceNote(note); setStep("register"); };

  // What does the server think of this device?
  useEffect(() => {
    if (!device || (step !== "checking" && step !== "pending")) return undefined;
    let stop = false;
    const check = async () => {
      try {
        const { data } = await getDeviceStatus(device);
        if (stop) return;
        if (data.status === "APPROVED") { setStep("login"); return; }
        if (data.status === "PENDING") { setPairingCode(data.pairingCode || ""); setStep("pending"); return; }
        startOver(data.status === "REJECTED" ? t("The admin rejected this device.") : t("This device was removed by the admin."));
      } catch (err) {
        if (stop) return;
        if (codeOf(err) === "DEVICE_NOT_REGISTERED") startOver(t("This device is no longer registered — register it again."));
        else if (step === "checking") setStep("login"); // server unreachable: let them try; login will say so
      }
    };
    check();
    const id = step === "pending" ? setInterval(check, POLL_MS) : null;
    return () => { stop = true; if (id) clearInterval(id); };
  }, [device, step]);

  const handleRegister = async () => {
    if (label.trim().length < 2) return toast.error(t("Give this device a name, e.g. \"Counter tablet\""));
    setLoading(true);
    try {
      const { data } = await registerDevice(label.trim());
      const d = { deviceId: data.deviceId, deviceSecret: data.deviceSecret, label: label.trim() };
      saveDevice(d);
      setDevice(d); setPairingCode(data.pairingCode); setDeviceNote(""); setStep("pending");
    } catch (err) { toast.error(msg(err, t("Couldn't register this device"))); }
    finally { setLoading(false); }
  };

  const handleLogin = async () => {
    if (phone.length !== 10) return toast.error(t("Enter a valid 10-digit phone number"));
    if (pin.length < PIN_MIN) return toast.error(t("Enter your PIN ({min}–{max} digits)", { min: PIN_MIN, max: PIN_MAX }));
    setLoading(true);
    try {
      const { data } = await pinLogin(device, phone, pin);
      if (roles && !roles.includes(data.role)) {
        toast.error(t("This account can't use this app. Ask your admin to check your role."));
        return;
      }
      if (data.local?.mustChangePin) { pending.current = { data, pin }; setPin(""); setStep("change"); return; }
      setPin("");
      onLoggedIn(data);
    } catch (err) {
      const code = codeOf(err);
      if (code === "DEVICE_NOT_REGISTERED") startOver(t("This device is no longer registered — register it again."));
      else if (code === "DEVICE_REVOKED") startOver(t("This device was removed by the admin."));
      else if (code === "DEVICE_PENDING") setStep("pending");
      else { toast.error(msg(err, t("Login failed"))); setPin(""); }
    } finally { setLoading(false); }
  };

  const handleChange = async () => {
    if (newPin.length < PIN_MIN) return toast.error(t("PIN must be {min}–{max} digits", { min: PIN_MIN, max: PIN_MAX }));
    if (newPin !== newPin2) return toast.error(t("The two PINs don't match"));
    const p = pending.current;
    if (!p) { setStep("login"); return; }
    setLoading(true);
    try {
      await changeOwnPin(p.data.token, p.pin, newPin);
      pending.current = null;
      setNewPin(""); setNewPin2("");
      toast.success(t("PIN changed"));
      onLoggedIn({ ...p.data, local: { ...p.data.local, mustChangePin: false } });
    } catch (err) {
      if (codeOf(err) === "SESSION_EXPIRED") { pending.current = null; setStep("login"); }
      toast.error(msg(err, t("Couldn't change the PIN")));
    } finally { setLoading(false); }
  };

  const input = {
    padding: "13px 14px", borderRadius: 12, border: `1px solid ${th.border}`, fontSize: 15, width: "100%",
    boxSizing: "border-box", fontFamily: "inherit", background: th.inputBg, color: th.text, outline: "none",
  };
  const pinInput = { ...input, textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: 800 };
  const digits = (set, max) => (e) => set(e.target.value.replace(/\D/g, "").slice(0, max));
  const btn = (
    <button type="submit" disabled={loading} style={{
      width: "100%", padding: 15, borderRadius: 14, border: "none", background: th.accent, color: th.accentText,
      fontWeight: 800, fontSize: 14.5, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: "inherit",
    }}>
      {loading ? t("Please wait…") : ({ register: t("Register this device"), login: t("Sign in"), change: t("Save my PIN") }[step])}
    </button>
  );
  const fieldLabel = (text) => <label style={{ fontSize: 11.5, fontWeight: 700, color: th.faint, display: "block", marginBottom: 6, textAlign: "left" }}>{text}</label>;
  const submit = (fn) => (e) => { e.preventDefault(); if (!loading) fn(); };
  const linkBtn = { border: "none", background: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: th.muted, fontFamily: "inherit", padding: 0 };

  const sub = {
    checking: t("Checking this device…"),
    register: t("First time on this device? Register it, then ask the admin to approve it."),
    pending: t("Waiting for the admin to approve this device"),
    login: t("Sign in with your phone number and PIN"),
    change: t("Choose your own PIN — the one you were given was temporary"),
  }[step];

  return (
    <div style={{ width: "100%", maxWidth: 380, margin: "0 auto", color: th.text }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: -0.4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: th.faint, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
        <div style={{ display: "inline-block", marginTop: 10, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: th.muted, border: `1px solid ${th.border}`, borderRadius: 99, padding: "3px 10px" }}>
          {t("RESTAURANT NETWORK")}
        </div>
      </div>

      {deviceNote && (
        <div role="alert" style={{ background: th.cardBg, border: `1px solid ${th.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 12.5, color: th.muted, marginBottom: 14 }}>{deviceNote}</div>
      )}

      {step === "checking" && <div style={{ textAlign: "center", color: th.muted, fontSize: 13 }}>{t("Please wait…")}</div>}

      {step === "register" && (
        <form onSubmit={submit(handleRegister)}>
          <div style={{ marginBottom: 16 }}>
            {fieldLabel(t("Device name"))}
            <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder={t("e.g. Counter tablet")} style={input} autoFocus />
          </div>
          {btn}
        </form>
      )}

      {step === "pending" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: th.muted, marginBottom: 8 }}>{t("Pairing code")}</div>
          <div aria-live="polite" style={{ fontSize: 34, fontWeight: 900, letterSpacing: 8, fontFamily: "ui-monospace, Menlo, Consolas, monospace", background: th.cardBg, border: `1px solid ${th.border}`, borderRadius: 14, padding: "16px 8px", marginBottom: 14 }}>
            {pairingCode || "······"}
          </div>
          <div style={{ fontSize: 12.5, color: th.muted, lineHeight: 1.5, marginBottom: 18 }}>
            {t("Ask the admin to open Admin → Devices, check that this code matches, and approve “{name}”. This screen moves on by itself.", { name: device?.label || label })}
          </div>
          <button type="button" style={linkBtn} onClick={() => startOver()}>{t("Cancel and register again")}</button>
        </div>
      )}

      {step === "login" && (
        <form onSubmit={submit(handleLogin)}>
          <div style={{ marginBottom: 14 }}>
            {fieldLabel(t("Phone number"))}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...input, width: 56, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+91</div>
              <input value={phone} onChange={digits(setPhone, 10)} inputMode="numeric" autoComplete="username" placeholder="98765 43210" style={{ ...input, flex: 1 }} autoFocus />
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            {fieldLabel(t("PIN"))}
            <input value={pin} onChange={digits(setPin, PIN_MAX)} type="password" inputMode="numeric" autoComplete="current-password" placeholder="••••••" style={pinInput} />
          </div>
          {btn}
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 11.5, color: th.faint }}>
            {t("Forgot your PIN? Ask the admin or manager to set a new one.")}
          </div>
        </form>
      )}

      {step === "change" && (
        <form onSubmit={submit(handleChange)}>
          <div style={{ marginBottom: 14 }}>
            {fieldLabel(t("New PIN ({min}–{max} digits)", { min: PIN_MIN, max: PIN_MAX }))}
            <input value={newPin} onChange={digits(setNewPin, PIN_MAX)} type="password" inputMode="numeric" autoComplete="new-password" style={pinInput} autoFocus />
          </div>
          <div style={{ marginBottom: 8 }}>
            {fieldLabel(t("Type it again"))}
            <input value={newPin2} onChange={digits(setNewPin2, PIN_MAX)} type="password" inputMode="numeric" autoComplete="new-password" style={pinInput} />
          </div>
          <div style={{ fontSize: 11.5, color: th.faint, marginBottom: 16, textAlign: "left" }}>{t("Not 111111, 123456 or part of your phone number.")}</div>
          {btn}
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" style={linkBtn} onClick={() => { pending.current = null; setStep("login"); }}>← {t("Back")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
