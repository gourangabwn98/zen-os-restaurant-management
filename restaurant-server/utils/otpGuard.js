// utils/otpGuard.js
// Send limit per phone for SMS OTPs: one per 30 s and at most 5 per hour
// (SMS cost, and stops one number being flooded). In-memory — resets on
// restart, which is fine for this purpose. No extra package.
const OTP_GAP_MS = 30 * 1000;
const OTP_HOUR_MAX = 5;
const otpSends = new Map(); // phone → [timestamps]

/** Records a send and returns null, or returns why this send is refused. */
export const otpSendBlocked = (phone, now = Date.now()) => {
  const recent = (otpSends.get(phone) || []).filter((t) => now - t < 3600 * 1000);
  if (recent.length && now - recent[recent.length - 1] < OTP_GAP_MS)
    return "Please wait 30 seconds before asking for another OTP";
  if (recent.length >= OTP_HOUR_MAX) return "Too many OTP requests for this number — try again in an hour";
  recent.push(now);
  otpSends.set(phone, recent);
  return null;
};
