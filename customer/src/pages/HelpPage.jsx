import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { submitSupportTicket } from "../services/supportService.js";
import { useAppState } from "../context/AppState.jsx";
import GlassCard from "../components/ui/GlassCard.jsx";
import PrimaryButton from "../components/ui/PrimaryButton.jsx";
import Chip from "../components/ui/Chip.jsx";
import { GREEN, TEXT_FAINT, GLASS_BG, GLASS_BORDER, NAV_HEIGHT } from "../theme.js";

const SUBJECTS = ["Order issue", "Billing / Payment", "Feedback", "General"];

export default function HelpPage() {
  const { auth } = useAppState();
  const [profile, setProfile] = useState(null);
  const [name, setName]   = useState(auth.user?.name  || "");
  const [phone, setPhone] = useState(auth.user?.phone || "");
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { getRestaurantProfile().then((r) => setProfile(r.data?.data)).catch(() => {}); }, []);

  const handleSubmit = async () => {
    if (!message.trim()) return toast.error("Please describe your issue");
    setSending(true);
    try {
      await submitSupportTicket({ name, phone, subject, message: message.trim() });
      setSent(true);
      setMessage("");
      toast.success("Message sent — we'll get back to you soon");
    } catch {
      toast.error("Couldn't send your message. Try calling us instead.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ paddingBottom: NAV_HEIGHT + 20 }}>
      <div style={{ padding: "20px 16px 10px", fontSize: 19, fontWeight: 800, color: "#fff" }}>Help & Support</div>

      {/* ── Quick contact ── */}
      {(profile?.phone || profile?.email) && (
        <div style={{ display: "flex", gap: 10, padding: "8px 16px" }}>
          {profile?.phone && <a href={`tel:${profile.phone}`} style={contactBtn}>📞 Call</a>}
          {profile?.phone && (
            <a href={`https://wa.me/91${profile.phone.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer" style={contactBtn}>
              💬 WhatsApp
            </a>
          )}
          {profile?.email && <a href={`mailto:${profile.email}`} style={contactBtn}>✉️ Email</a>}
        </div>
      )}

      {/* ── Form ── */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: "#fff" }}>Send us a message</div>

        {sent ? (
          <GlassCard style={{ padding: "26px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 30 }}>✅</div>
            <div style={{ fontWeight: 700, marginTop: 8, color: "#fff" }}>Message sent!</div>
            <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 4 }}>We usually reply within a few hours.</div>
            <button onClick={() => setSent(false)} style={{ marginTop: 14, border: "none", background: "none", color: GREEN, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              Send another message
            </button>
          </GlassCard>
        ) : (
          <>
            <Field label="Your Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Phone (optional)">
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" style={inputStyle} />
            </Field>
            <Field label="Subject">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SUBJECTS.map((s) => (
                  <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>{s}</Chip>
                ))}
              </div>
            </Field>
            <Field label="Message">
              <textarea
                value={message} onChange={(e) => setMessage(e.target.value)}
                rows={4} placeholder="Tell us what's going on…"
                style={{ ...inputStyle, resize: "none" }}
              />
            </Field>
            <PrimaryButton onClick={handleSubmit} disabled={sending} style={{ marginTop: 6 }}>
              {sending ? "Sending…" : "Send Message"}
            </PrimaryButton>
          </>
        )}
      </div>
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
  width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${GLASS_BORDER}`,
  fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", background: GLASS_BG, color: "#fff",
};

const contactBtn = {
  flex: 1, textAlign: "center", padding: "13px 8px", borderRadius: 14, border: `1px solid ${GLASS_BORDER}`,
  background: GLASS_BG, fontSize: 12.5, fontWeight: 700, textDecoration: "none", color: "#fff",
};
