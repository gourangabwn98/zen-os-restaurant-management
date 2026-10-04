import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { sendEmployeeOTP, verifyEmployeeOTP } from "../services/authService.js";
import { useAppState } from "../context/AppState.jsx";
import { AMBER, TEXT_MUTED, BORDER } from "../theme.js";
import { t, LanguageToggle } from "../i18n/index.jsx";
import { BRAND } from "../brand.js";

export default function LoginPage() {
  const nav = useNavigate();
  const { auth } = useAppState();

  const [step, setStep]       = useState("phone");
  const [phone, setPhone]     = useState("");
  const [otp, setOtp]         = useState("");
  const [staffName, setStaffName] = useState("");
  const [loading, setLoading] = useState(false);
  const [timer, setTimer]     = useState(0);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const handleSend = async () => {
    if (phone.length !== 10) return toast.error(t("Enter a valid 10-digit phone number"));
    setLoading(true);
    try {
      const { data } = await sendEmployeeOTP(phone);
      setStaffName(data.staffName || "");
      setStep("otp");
      setTimer(120);
      toast.success(t("OTP sent to +91 {phone}", { phone }));
    } catch (err) {
      toast.error(err.response?.data?.message || t("Couldn't send OTP"));
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return toast.error(t("Enter the 6-digit OTP"));
    setLoading(true);
    try {
      const { data } = await verifyEmployeeOTP(phone, otp);
      if (data.role !== "chef" && data.role !== "admin") {
        toast.error(t("This account isn't registered as kitchen staff. Ask your admin to check your role."));
        setLoading(false);
        return;
      }
      auth.login(data);
      toast.success(t("Welcome, {name}!", { name: data.name || t("Chef") }));
      nav("/board", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || t("Wrong OTP — try again"));
    } finally { setLoading(false); }
  };

  const handleBack = () => { setStep("phone"); setOtp(""); };
  const handleResend = () => { if (timer > 0) return; handleBack(); setTimeout(handleSend, 100); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        {/* GLB-01: Hotel KHOAI mark + wordmark (src/brand.js) */}
        <img src={BRAND.mark} alt={BRAND.name} width="72" height="72" style={{ display: "block", margin: "0 auto 10px", borderRadius: "50%" }} />
        <img src={BRAND.wordmark} alt="" style={{ display: "block", margin: "0 auto 4px", height: 30, width: "auto" }} />
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: TEXT_MUTED, textTransform: "uppercase", marginBottom: 12 }}>{BRAND.name} · {t("Kitchen")}</div>
        <div style={{ fontWeight: 800, fontSize: 20, marginTop: 8 }}>
          {step === "phone" ? t("Kitchen login") : t("Hi {name}, verify your number", { name: staffName || t("there") })}
        </div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>
          {step === "phone" ? t("Enter your registered kitchen staff phone number") : t("Code sent to +91 {phone}", { phone })}
        </div>
      </div>

      {step === "phone" ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <div style={{ ...inputStyle, width: 56, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+91</div>
            <input
              value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onKeyDown={(e) => e.key === "Enter" && handleSend()} inputMode="numeric" autoFocus
              placeholder="98765 43210" style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          <Btn onClick={handleSend} loading={loading}>{t("Send OTP")} →</Btn>
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
              letterSpacing: 10, fontWeight: 800, border: `2px solid ${otp.length === 6 ? AMBER : BORDER}`,
              boxSizing: "border-box", marginBottom: 18, background: "#161a22", color: "#fff",
            }}
          />
          <Btn id="verify-btn" onClick={handleVerify} loading={loading}>{t("Verify & continue")} ✓</Btn>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={handleBack} style={linkBtn}>← {t("Change number")}</button>
            <button onClick={handleResend} disabled={timer > 0} style={{ ...linkBtn, color: timer > 0 ? TEXT_MUTED : AMBER }}>
              {timer > 0 ? t("Resend in {time}", { time: `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` }) : t("Resend OTP")}
            </button>
          </div>
        </>
      )}
      <LanguageToggle style={{ marginTop: 22 }} />
    </div>
  );
}

const Btn = ({ children, onClick, loading, id }) => (
  <button id={id} onClick={onClick} disabled={loading} style={{
    width: "100%", padding: 15, borderRadius: 14, border: "none",
    background: loading ? "#b8863f" : AMBER, color: "#111", fontWeight: 800, fontSize: 14.5,
    cursor: loading ? "not-allowed" : "pointer",
  }}>
    {loading ? t("Please wait…") : children}
  </button>
);

const inputStyle = {
  padding: "13px 14px", borderRadius: 12, border: `1px solid ${BORDER}`, fontSize: 15,
  boxSizing: "border-box", fontFamily: "inherit", width: "100%", background: "#161a22", color: "#fff",
};

const linkBtn = { border: "none", background: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: TEXT_MUTED };
