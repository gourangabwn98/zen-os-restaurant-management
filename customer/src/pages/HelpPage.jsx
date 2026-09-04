import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getRestaurantProfile } from "../services/restaurantService.js";
import { submitSupportTicket } from "../services/supportService.js";
import { useAppState } from "../context/AppState.jsx";
import { PINK, TEXT_MUTED, TEXT_FAINT, BORDER, NAV_HEIGHT } from "../theme.js";

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
      <div style={{ padding: "16px 16px 4px", fontSize: 18, fontWeight: 800 }}>Help & Support</div>

      {/* ── Quick contact ── */}
      {(profile?.phone || profile?.email) && (
        <div style={{ display: "flex", gap: 10, padding: "12px 16px" }}>
          {profile?.phone && (
            <a href={`tel:${profile.phone}`} style={contactBtn}>📞 Call</a>
          )}
          {profile?.phone && (
            <a href={`https://wa.me/91${profile.phone.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer" style={contactBtn}>
              💬 WhatsApp
            </a>
          )}
          {profile?.email && (
            <a href={`mailto:${profile.email}`} style={contactBtn}>✉️ Email</a>
          )}
        </div>
      )}

      {/* ── Form ── */}
      <div style={{ padding: "8px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Send us a message</div>

        {sent ? (
          <div style={{
            padding: "22px 16px", textAlign: "center", background: "#f0fdf4", borderRadius: 12,
            border: "1px solid rgba(22,163,74,0.25)",
          }}>
            <div style={{ fontSize: 30 }}>✅</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>Message sent!</div>
            <div style={{ fontSize: 12.5, color: TEXT_FAINT, marginTop: 4 }}>We usually reply within a few hours.</div>
            <button onClick={() => setSent(false)} style={{ marginTop: 14, border: "none", background: "none", color: PINK, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              Send another message
            </button>
          </div>
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
                  <button key={s} onClick={() => setSubject(s)} style={{
                    padding: "7px 13px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: `1.5px solid ${subject === s ? PINK : BORDER}`,
                    background: subject === s ? "rgba(224,17,95,0.08)" : "#fff",
                    color: subject === s ? PINK : TEXT_MUTED,
                  }}>
                    {s}
                  </button>
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
            <button onClick={handleSubmit} disabled={sending} style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none", marginTop: 6,
              background: PINK, color: "#fff", fontWeight: 800, fontSize: 14,
              cursor: sending ? "not-allowed" : "pointer", opacity: sending ? 0.6 : 1,
            }}>
              {sending ? "Sending…" : "Send Message"}
            </button>
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
  width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${BORDER}`,
  fontSize: 14, boxSizing: "border-box", fontFamily: "inherit",
};

const contactBtn = {
  flex: 1, textAlign: "center", padding: "12px 8px", borderRadius: 12, border: `1px solid ${BORDER}`,
  background: "#fff", fontSize: 12.5, fontWeight: 700, textDecoration: "none", color: "#111",
};
