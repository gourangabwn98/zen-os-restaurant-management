import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth as firebaseAuth } from "../firebase.js";
import { firebaseVerify } from "../services/authService.js";
import { useAppState } from "../context/AppState.jsx";
import Button from "../components/ui/Button.jsx";
import Icon from "../components/ui/Icon.jsx";

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
    <div className="auth">
      <div id="recaptcha-container" />

      <button type="button" className="icon-btn" onClick={() => nav(-1)} aria-label="Back">
        <Icon name="back" />
      </button>

      <div className="welcome" style={{ marginBottom: 18 }}>
        <div className="tno" aria-hidden="true">{step === "phone" ? "🍽️" : "🔐"}</div>
        <h3 style={{ fontSize: 24, fontWeight: 850, letterSpacing: "-.02em" }}>
          {step === "phone" ? "Log in to order" : "Verify your number"}
        </h3>
        <p className="muted small" style={{ marginTop: 4 }}>
          {step === "phone" ? "We'll text you a one-time code" : `Code sent to +91 ${phone}`}
        </p>
      </div>

      {step === "phone" ? (
        <>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
          </label>
          <div className="field">
            <span>Phone number</span>
            <div className="phone-in">
              <div className="cc">+91</div>
              <input
                className="input" value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && handleSend()} inputMode="numeric" autoFocus
                placeholder="98765 43210" aria-label="Phone number" autoComplete="tel-national"
              />
            </div>
          </div>
          <Button onClick={handleSend} loading={loading} style={{ marginTop: 8 }}>
            {loading ? "Please wait…" : "Send OTP"}
          </Button>
        </>
      ) : (
        <>
          <input
            className={`otp-in${otp.length === 6 ? " full" : ""}`}
            value={otp}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setOtp(v);
              if (v.length === 6) setTimeout(() => document.getElementById("verify-btn")?.click(), 100);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            placeholder="• • • • • •" inputMode="numeric" autoFocus autoComplete="one-time-code"
            aria-label="6-digit OTP"
          />
          <Button id="verify-btn" onClick={handleVerify} loading={loading} style={{ marginTop: 18 }}>
            {loading ? "Please wait…" : "Verify & continue"}
          </Button>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button type="button" className="link-btn" style={{ color: "var(--text-2)" }} onClick={handleBack}>← Change number</button>
            <button
              type="button" className="link-btn" onClick={handleResend} disabled={timer > 0}
              style={{ color: timer > 0 ? "var(--text-3)" : "var(--brand)" }}
            >
              {timer > 0 ? `Resend in ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` : "Resend OTP"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
