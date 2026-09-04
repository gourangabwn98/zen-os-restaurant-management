import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { sendEmployeeOTP, verifyEmployeeOTP } from "../services/authService.js";
import { useAppState } from "../context/AppState.jsx";
import { AMBER, TEXT_MUTED, BORDER } from "../theme.js";

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
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const handleSend = async () => {
    if (phone.length !== 10) return toast.error("Enter a valid 10-digit phone number");
    setLoading(true);
    try {
      const { data } = await sendEmployeeOTP(phone);
      setStaffName(data.staffName || "");
      setStep("otp");
      setTimer(120);
      toast.success(`OTP sent to +91 ${phone}`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't send OTP");
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");
    setLoading(true);
    try {
      const { data } = await verifyEmployeeOTP(phone, otp);
      if (data.role !== "chef" && data.role !== "admin") {
        toast.error("This account isn't registered as kitchen staff. Ask your admin to check your role.");
        setLoading(false);
        return;
      }
      auth.login(data);
      toast.success(`Welcome, ${data.name || "Chef"}!`);
      nav("/board", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Wrong OTP — try again");
    } finally { setLoading(false); }
  };

  const handleBack = () => { setStep("phone"); setOtp(""); };
  const handleResend = () => { if (timer > 0) return; handleBack(); setTimeout(handleSend, 100); };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44 }}>🍳</div>
        <div style={{ fontWeight: 800, fontSize: 20, marginTop: 8 }}>
          {step === "phone" ? "Kitchen Login" : `Hi ${staffName || "there"}, verify your number`}
        </div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>
          {step === "phone" ? "Enter your registered kitchen staff phone number" : `Code sent to +91 ${phone}`}
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
              letterSpacing: 10, fontWeight: 800, border: `2px solid ${otp.length === 6 ? AMBER : BORDER}`,
              boxSizing: "border-box", marginBottom: 18, background: "#161a22", color: "#fff",
            }}
          />
          <Btn id="verify-btn" onClick={handleVerify} loading={loading}>Verify & Continue ✓</Btn>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={handleBack} style={linkBtn}>← Change number</button>
            <button onClick={handleResend} disabled={timer > 0} style={{ ...linkBtn, color: timer > 0 ? TEXT_MUTED : AMBER }}>
              {timer > 0 ? `Resend in ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` : "Resend OTP"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const Btn = ({ children, onClick, loading, id }) => (
  <button id={id} onClick={onClick} disabled={loading} style={{
    width: "100%", padding: 15, borderRadius: 14, border: "none",
    background: loading ? "#b8863f" : AMBER, color: "#111", fontWeight: 800, fontSize: 14.5,
    cursor: loading ? "not-allowed" : "pointer",
  }}>
    {loading ? "Please wait…" : children}
  </button>
);

const inputStyle = {
  padding: "13px 14px", borderRadius: 12, border: `1px solid ${BORDER}`, fontSize: 15,
  boxSizing: "border-box", fontFamily: "inherit", width: "100%", background: "#161a22", color: "#fff",
};

const linkBtn = { border: "none", background: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: TEXT_MUTED };
