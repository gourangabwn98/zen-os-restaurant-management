// utils/sendWhatsAppText.js
import twilio from "twilio";

/** Sends a plain WhatsApp text via Twilio. Silently no-ops if not configured
 * or if the send fails — this must never block the caller's main action
 * (e.g. creating a support ticket still succeeds even if the notification
 * doesn't go out). */
export const sendWhatsAppText = async (toPhone, message) => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM || "+14155238886";
  if (!sid || !token || !toPhone) {
    console.warn("⚠️  WhatsApp notify skipped (Twilio not configured or no phone)");
    return false;
  }
  try {
    const client = twilio(sid, token);
    await client.messages.create({
      from: `whatsapp:${from}`,
      to:   `whatsapp:+91${String(toPhone).replace(/\D/g, "").slice(-10)}`,
      body: message,
    });
    return true;
  } catch (err) {
    console.error("WhatsApp send failed:", err.message);
    return false;
  }
};
