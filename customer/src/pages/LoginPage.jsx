import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth as firebaseAuth } from "../firebase.js";
import { firebaseVerify } from "../services/authService.js";
import { useAppState } from "../context/AppState.jsx";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER } from "../theme.js";

export default function LoginPage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  const [step, setStep]       = useState("phone"); // "phone" | "otp"
  const [phone, setPhone]     = useState("");
  const [name, setName]       = useState("");
  const [otp, setOtp]         = useState("");
  const [loading, setLoading] = useState(false);
  const [timer, setTimer]     = useState(0);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", { size: "invisible" });
    }
  };

  const handleSend = async () => {
    if (phone.length !== 10) return toast.error("Enter a valid 10-digit phone number");
    setLoading(true);
    try {
      setupRecaptcha();
      const result = await signInWithPhoneNumber(firebaseAuth, `+91${phone}`, window.recaptchaVerifier);
      confirmRef.current = result;
      setStep("otp");
      setTimer(120);
      toast.success(`OTP sent to +91 ${phone}`);
    } catch (err) {
      if (window.recaptchaVerifier) { window.recaptchaVerifier.clear(); window.recaptchaVerifier = null; }
      toast.error(err.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");
    if (!confirmRef.current) return toast.error("Please resend the OTP");
    setLoading(true);
    try {
      await confirmRef.current.confirm(otp);
      const { data } = await firebaseVerify((await firebaseAuth.currentUser.getIdToken()), name.trim());
      auth.login(data);
      toast.success(`Welcome${data.name ? `, ${data.name}` : ""}!`);
      nav("/profile", { replace: true });
    } catch (err) {
      if (err.code === "auth/invalid-verification-code") toast.error("Wrong OTP. Try again.");
      else if (err.code === "auth/code-expired") { toast.error("OTP expired — resend it"); setStep("phone"); setOtp(""); }
      else toast.error(err.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep("phone"); setOtp(""); confirmRef.current = null;
    if (window.recaptchaVerifier) { window.recaptchaVerifier.clear(); window.recaptchaVerifier = null; }
  };
  const handleResend = () => { if (timer > 0) return; handleBack(); setTimeout(handleSend, 100); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
      <div id="recaptcha-container" />

      <button onClick={() => nav(-1)} style={{
        position: "absolute", top: 18, left: 18, border: "none", background: "none",
        fontSize: 20, cursor: "pointer", color: TEXT_MUTED,
      }}>←</button>

      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 40 }}>🍽️</div>
        <div style={{ fontWeight: 800, fontSize: 19, marginTop: 8 }}>
          {step === "phone" ? "Log in to order" : "Verify your number"}
        </div>
        <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 4 }}>
          {step === "phone" ? "We'll text you a one-time code" : `Code sent to +91 ${phone}`}
        </div>
      </div>

      {step === "phone" ? (
        <>
          <Field label="Your Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={inputStyle} />
          </Field>
          <Field label="Phone Number">
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...inputStyle, width: 56, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+91</div>
              <input
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && handleSend()} inputMode="numeric" autoFocus
                placeholder="98765 43210" style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </Field>
          <Btn onClick={handleSend} loading={loading}>Send OTP →</Btn>
        </>
      ) : (
        <>
          <input
            value={otp}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setOtp(v);
              if (v.length === 6) setTimeout(() => document.getElementById("verify-btn")?.click(), 100);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            placeholder="• • • • • •" inputMode="numeric" autoFocus
            style={{
              width: "100%", padding: 16, borderRadius: 12, textAlign: "center", fontSize: 26,
              letterSpacing: 10, fontWeight: 800, border: `2px solid ${otp.length === 6 ? PINK : BORDER}`,
              boxSizing: "border-box", marginBottom: 18,
            }}
          />
          <Btn id="verify-btn" onClick={handleVerify} loading={loading}>Verify & Continue ✓</Btn>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={handleBack} style={linkBtn}>← Change number</button>
            <button onClick={handleResend} disabled={timer > 0} style={{ ...linkBtn, color: timer > 0 ? TEXT_FAINT : PINK }}>
              {timer > 0 ? `Resend in ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` : "Resend OTP"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const Btn = ({ children, onClick, loading, id }) => (
  <button id={id} onClick={onClick} disabled={loading} style={{
    width: "100%", padding: 15, borderRadius: 14, border: "none",
    background: loading ? "#f3c9d8" : PINK, color: "#fff", fontWeight: 800, fontSize: 14.5,
    cursor: loading ? "not-allowed" : "pointer",
  }}>
    {loading ? "Please wait…" : children}
  </button>
);

const inputStyle = {
  padding: "13px 14px", borderRadius: 12, border: `1px solid ${BORDER}`, fontSize: 15,
  boxSizing: "border-box", fontFamily: "inherit", width: "100%",
};

const linkBtn = { border: "none", background: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: TEXT_MUTED };
