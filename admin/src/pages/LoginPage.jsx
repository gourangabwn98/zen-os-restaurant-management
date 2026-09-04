// src/pages/LoginPage.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import api from "../services/api.js";
import toast from "react-hot-toast";
import { PRIMARY } from "../theme.js";
import { auth } from "../firebase.js";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
// import logo from "../assets/charu_logo.webp";
import logo from "../assets/charu_logo.webp";

const PINK = PRIMARY;

export default function LoginPage() {
  const nav        = useNavigate();
  const { login }  = useAuth();

  const [step,    setStep]    = useState("phone"); // "phone" | "otp"
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [loading, setLoading] = useState(false);
  const [timer,   setTimer]   = useState(0);

  const confirmRef = useRef(null); // holds Firebase confirmationResult

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // ── Setup invisible reCAPTCHA ──────────────────────────────────────────────
  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        { size: "invisible" }
      );
    }
  };

  // ── Step 1: Send OTP via Firebase ─────────────────────────────────────────
  const handleSend = async () => {
    if (phone.length !== 10) return toast.error("Enter valid 10-digit phone");
    setLoading(true);
    try {
      setupRecaptcha();
      const fullPhone = `+91${phone}`;
      const result = await signInWithPhoneNumber(
        auth, fullPhone, window.recaptchaVerifier
      );
      confirmRef.current = result;
      setStep("otp");
      setTimer(120); // 2 min countdown
      toast.success(`OTP sent to +91 ${phone}`);
    } catch (err) {
      console.error(err);
      // Reset recaptcha on error so user can retry
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
      toast.error(err.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP via Firebase then login via our backend ────────────
  const handleVerify = async () => {
    if (otp.length !== 6) return toast.error("Enter 6-digit OTP");
    if (!confirmRef.current) return toast.error("Please resend OTP");
    setLoading(true);
    try {
      // Verify with Firebase
      await confirmRef.current.confirm(otp);

      // Firebase verified — now get our JWT from backend
      const { data } = await api.post("/auth/admin/firebase-login", { phone });
      login(data);
      nav("/admin");
      toast.success(`Welcome, ${data.name || "Admin"}!`);
    } catch (err) {
      console.error(err);
      if (err.code === "auth/invalid-verification-code") {
        toast.error("Wrong OTP. Try again.");
      } else if (err.code === "auth/code-expired") {
        toast.error("OTP expired. Please resend.");
        setStep("phone");
        setOtp("");
      } else {
        toast.error(err.response?.data?.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep("phone");
    setOtp("");
    confirmRef.current = null;
    if (window.recaptchaVerifier) {
      window.recaptchaVerifier.clear();
      window.recaptchaVerifier = null;
    }
  };

  const handleResend = () => {
    if (timer > 0) return;
    handleBack();
    setTimeout(handleSend, 100);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f0d18 0%, #1a1625 50%, #12101a 100%)",
      backgroundImage: "radial-gradient(ellipse at 30% 30%, rgba(124,58,237,0.2) 0%, transparent 60%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
    }}>

      {/* Invisible reCAPTCHA container — required by Firebase */}
      <div id="recaptcha-container" />

      <div style={{
        background: "#13111f", borderRadius: 20, padding: "40px 36px",
        width: 360, textAlign: "center",
        border: "1px solid rgba(139,92,246,0.2)",
        boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.08)",
      }}>

        {/* Logo */}
   <div style={{
  width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px",
  background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 8px 24px rgba(124,58,237,0.4)",
  overflow: "hidden",
}}>
  <img
    src={logo}
    alt="Logo"
    style={{ width: "100%", height: "100%", objectFit: "cover" }}
  />
</div>

        <div style={{ color: "#c4b5fd", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>
          Zen OS
        </div>
        <div style={{ color: "#4b5563", fontSize: 11, letterSpacing: 3, marginBottom: 32 }}>
          ADMIN PANEL
        </div>

        {/* ── Step: Phone ── */}
        {step === "phone" && (
          <>
            <div style={{ textAlign: "left", marginBottom: 20 }}>
              <label style={{
                fontSize: 12, color: "#9ca3af", display: "block",
                marginBottom: 8, fontWeight: 600, letterSpacing: 0.5,
              }}>
                Admin Phone Number
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{
                  padding: "11px 12px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#252038", fontSize: 14,
                  display: "flex", alignItems: "center", gap: 6,
                  color: "#9ca3af", flexShrink: 0,
                }}>
                  🇮🇳 +91
                </div>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && handleSend()}
                  maxLength={10}
                  placeholder="98765 43210"
                  type="tel"
                  autoFocus
                  style={{
                    flex: 1, padding: "11px 14px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, fontSize: 15,
                    background: "#1a1625", color: "#f1f0f5",
                    outline: "none", boxSizing: "border-box",
                    letterSpacing: 1, transition: "border .2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(124,58,237,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                />
              </div>
              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8 }}>
                Enter the phone number registered with your restaurant
              </div>
            </div>
            <Btn onClick={handleSend} loading={loading} pink={PINK}>
              Send OTP →
            </Btn>
          </>
        )}

        {/* ── Step: OTP ── */}
        {step === "otp" && (
          <>
            <div style={{
              background: "rgba(124,58,237,0.08)",
              border: "1px solid rgba(124,58,237,0.2)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 20,
              fontSize: 13, color: "#9ca3af", lineHeight: 1.5,
            }}>
              OTP sent to{" "}
              <span style={{ color: "#c4b5fd", fontWeight: 700 }}>+91 {phone}</span>
              <br/>
              <span style={{ fontSize: 11 }}>Sent via Firebase · Check SMS</span>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{
                fontSize: 12, color: "#9ca3af", display: "block",
                marginBottom: 10, fontWeight: 600, textAlign: "left", letterSpacing: 0.5,
              }}>
                Enter 6-digit OTP
              </label>
              <input
                value={otp}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, "");
                  setOtp(val);
                  if (val.length === 6) {
                    setTimeout(() => document.getElementById("verify-btn")?.click(), 100);
                  }
                }}
                onKeyDown={e => e.key === "Enter" && handleVerify()}
                maxLength={6}
                placeholder="• • • • • •"
                type="tel"
                autoFocus
                style={{
                  width: "100%", padding: "16px",
                  border: `2px solid ${otp.length === 6 ? PINK : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 12, fontSize: 28,
                  textAlign: "center", fontWeight: 700,
                  letterSpacing: 12,
                  background: "#1a1625", color: "#f1f0f5",
                  outline: "none", boxSizing: "border-box",
                  transition: "border .2s",
                }}
              />
            </div>

            <Btn id="verify-btn" onClick={handleVerify} loading={loading} pink={PINK}>
              {loading ? "Verifying…" : "Verify & Login ✓"}
            </Btn>

            {/* Timer + resend + back */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <button onClick={handleBack} style={{
                background: "none", border: "none", color: "#6b7280",
                fontSize: 13, cursor: "pointer", fontWeight: 500,
              }}>
                ← Change number
              </button>
              <button onClick={handleResend} disabled={timer > 0 || loading} style={{
                background: "none", border: "none",
                color: timer > 0 ? "#4b5563" : PINK,
                fontSize: 13, cursor: timer > 0 ? "default" : "pointer", fontWeight: 600,
              }}>
                {timer > 0
                  ? `Resend in ${Math.floor(timer/60)}:${String(timer%60).padStart(2,"0")}`
                  : "Resend OTP"}
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: 28, fontSize: 11, color: "#1f1d2e" }}>
          Zen OS v1.0
        </div>
      </div>
    </div>
  );
}

const Btn = ({ children, onClick, loading, pink, id }) => (
  <button id={id} onClick={onClick} disabled={loading} style={{
    width: "100%", padding: "13px",
    background: loading ? "#1f1d2e" : `linear-gradient(135deg, ${pink}, #5b21b6)`,
    color: loading ? "#4b5563" : "#fff",
    border: "none", borderRadius: 25,
    fontWeight: 700, fontSize: 14,
    cursor: loading ? "not-allowed" : "pointer",
    boxShadow: loading ? "none" : "0 4px 20px rgba(124,58,237,0.4)",
    transition: "all .2s",
  }}>
    {loading ? "Please wait…" : children}
  </button>
);