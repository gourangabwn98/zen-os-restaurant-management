import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { RecaptchaVerifier, signInWithPhoneNumber, signOut } from "firebase/auth";
import { auth as firebaseAuth } from "../firebase.js";
import { checkStaffPhone, firebaseStaffLogin } from "../services/authService.js";
import { useAppState } from "../context/AppState.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import { ACCENT, TEXT_MUTED, TEXT_FAINT, GLASS_BG, GLASS_BORDER } from "../theme.js";
import { t, LanguageToggle } from "../i18n/index.jsx";
import { BRAND } from "../brand.js";

export default function LoginPage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  const [step, setStep]       = useState("phone"); // "phone" | "otp"
  const [phone, setPhone]     = useState("");
  const [otp, setOtp]         = useState("");
  const [staffName, setStaffName] = useState("");
  const [loading, setLoading] = useState(false);
  const [timer, setTimer]     = useState(0);
  const confirmRef = useRef(null); // Firebase ConfirmationResult for the pending OTP

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Staff login uses Firebase Phone Auth — the same SMS service as the
  // customer app. The backend checks the number is active staff first (so no
  // SMS goes to an unknown number), then exchanges the verified Firebase
  // token for a staff session.
  const resetRecaptcha = () => {
    if (window.recaptchaVerifier) { window.recaptchaVerifier.clear(); window.recaptchaVerifier = null; }
  };

  const handleSend = async () => {
    if (phone.length !== 10) return toast.error(t("Enter a valid 10-digit phone number"));
    setLoading(true);
    try {
      const { data } = await checkStaffPhone(phone);
      setStaffName(data.staffName || "");
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", { size: "invisible" });
      }
      confirmRef.current = await signInWithPhoneNumber(firebaseAuth, `+91${phone}`, window.recaptchaVerifier);
      setStep("otp");
      setTimer(120);
      toast.success(t("OTP sent to +91 {phone}", { phone }));
    } catch (err) {
      resetRecaptcha();
      toast.error(err.response?.data?.message || err.message || t("Couldn't send OTP"));
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return toast.error(t("Enter the 6-digit OTP"));
    if (!confirmRef.current) return toast.error(t("Please resend the OTP"));
    setLoading(true);
    try {
      const cred = await confirmRef.current.confirm(otp);
      const { data } = await firebaseStaffLogin(await cred.user.getIdToken());
      // Our own JWT is the session from here on — drop the Firebase one.
      signOut(firebaseAuth).catch(() => {});
      auth.login(data);
      toast.success(t("Welcome, {name}!", { name: data.name || t("there") }));
      nav("/tables", { replace: true });
    } catch (err) {
      if (err.code === "auth/invalid-verification-code") toast.error(t("Wrong OTP — try again"));
      else if (err.code === "auth/code-expired") { toast.error(t("OTP expired — resend it")); handleBack(); }
      else toast.error(err.response?.data?.message || t("Login failed"));
    } finally { setLoading(false); }
  };

  const handleBack = () => { setStep("phone"); setOtp(""); confirmRef.current = null; resetRecaptcha(); };
  const handleResend = () => { if (timer > 0) return; handleBack(); setTimeout(handleSend, 100); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
     <div style={{ textAlign: "center", marginBottom: 30 }}>
  {/* Hotel KHOAI mark + Bengali wordmark */}
  <img
    src={BRAND.mark}
    alt={BRAND.name}
    width="72"
    height="72"
    style={{
      display: "block",
      margin: "0 auto 10px",
      borderRadius: "50%",
    }}
  />

  <img
    src={BRAND.wordmark}
    alt="খোয়াই"
    style={{
      display: "block",
      height: 30,
      width: "auto",
      margin: "0 auto 16px",
    }}
  />

  <div
    style={{
      fontWeight: 800,
      fontSize: 21,
      color: "#fff",
      letterSpacing: -0.4,
    }}
  >
    {step === "phone"
      ? t("Waiter login")
      : t("Hi {name}, verify your number", {
          name: staffName || t("there"),
        })}
  </div>

  <div
    style={{
      fontSize: 12.5,
      color: TEXT_FAINT,
      marginTop: 4,
    }}
  >
    {step === "phone"
      ? t("Enter your registered staff phone number")
      : t("Code sent to +91 {phone}", { phone })}
  </div>
</div>

      {step === "phone" ? (
        <>
          <Field label={t("Phone number")}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ ...inputStyle, width: 56, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+91</div>
              <input
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && handleSend()} inputMode="numeric" autoFocus
                placeholder="98765 43210" style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </Field>
          <PrimaryButton onClick={handleSend} loading={loading} style={{ width: "100%" }}>
            {loading ? t("Please wait…") : `${t("Send OTP")} →`}
          </PrimaryButton>
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
              width: "100%", padding: 16, borderRadius: 14, textAlign: "center", fontSize: 26,
              letterSpacing: 10, fontWeight: 800, border: `2px solid ${otp.length === 6 ? ACCENT : GLASS_BORDER}`,
              boxSizing: "border-box", marginBottom: 18, background: GLASS_BG, color: "#fff",
            }}
          />
          <PrimaryButton id="verify-btn" onClick={handleVerify} loading={loading} style={{ width: "100%" }}>
            {loading ? t("Please wait…") : `${t("Verify & continue")} ✓`}
          </PrimaryButton>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={handleBack} style={linkBtn}>← {t("Change number")}</button>
            <button onClick={handleResend} disabled={timer > 0} style={{ ...linkBtn, color: timer > 0 ? TEXT_FAINT : ACCENT }}>
              {timer > 0 ? t("Resend in {time}", { time: `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` }) : t("Resend OTP")}
            </button>
          </div>
        </>
      )}
      <LanguageToggle style={{ marginTop: 22 }} />
      <div id="recaptcha-container" />
    </div>
  );
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 11.5, fontWeight: 700, color: TEXT_FAINT, display: "block", marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);

const inputStyle = {
  padding: "13px 14px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`, fontSize: 15,
  boxSizing: "border-box", fontFamily: "inherit", width: "100%", background: GLASS_BG, color: "#fff",
};

const linkBtn = { border: "none", background: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: TEXT_MUTED };
