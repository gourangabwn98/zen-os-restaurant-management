import { useState } from "react";
import toast from "react-hot-toast";
import { submitSupportTicket } from "../services/supportService.js";
import { useAppState } from "../context/AppState.jsx";
import { useRestaurantProfile } from "../hooks/useRestaurantProfile.js";
import Button from "../components/ui/Button.jsx";

const SUBJECTS = ["Order issue", "Billing / Payment", "Feedback", "General"];

export default function HelpPage() {
  const { auth } = useAppState();
  const profile = useRestaurantProfile();
  const [name, setName]   = useState(auth.user?.name  || "");
  const [phone, setPhone] = useState(auth.user?.phone || "");
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

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
    <>
      <div className="page-h">
        <h2>How can we help?</h2>
        <p>Reach the restaurant directly, or send us a message.</p>
      </div>

      {/* ── Quick contact ── */}
      {(profile?.phone || profile?.email) && (
        <div className="help-grid">
          {profile?.phone && <a href={`tel:${profile.phone}`} className="hot"><span>📞</span>Call</a>}
          {profile?.phone && (
            <a href={`https://wa.me/91${profile.phone.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer">
              <span>💬</span>WhatsApp
            </a>
          )}
          {profile?.email && <a href={`mailto:${profile.email}`}><span>✉️</span>Email</a>}
        </div>
      )}

      {/* ── Form ── */}
      <div className="sec-h"><h3>Send us a message</h3></div>

      {sent ? (
        <div className="card center" style={{ padding: "26px 16px" }}>
          <div style={{ fontSize: 40 }} aria-hidden="true">✅</div>
          <div style={{ fontWeight: 800, marginTop: 8 }}>Message sent!</div>
          <p className="muted small" style={{ marginTop: 4 }}>We usually reply within a few hours.</p>
          <button type="button" className="link-btn" style={{ marginTop: 14 }} onClick={() => setSent(false)}>
            Send another message
          </button>
        </div>
      ) : (
        <>
          <div className="two">
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label className="field">
              <span>Phone (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" />
            </label>
          </div>
          <div className="field">
            <span>Subject</span>
            <div className="chips" role="group" aria-label="Subject">
              {SUBJECTS.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={subject === s} onClick={() => setSubject(s)}>{s}</button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Tell us what's going on…" />
          </label>
          <Button onClick={handleSubmit} disabled={sending} style={{ marginTop: 6 }}>
            {sending ? "Sending…" : "Send message"}
          </Button>
        </>
      )}
    </>
  );
}
