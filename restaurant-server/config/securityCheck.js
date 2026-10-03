// config/securityCheck.js
// ─────────────────────────────────────────────────────────────────────────────
// Startup self-check of the deployment settings that security depends on.
// Never prints a secret value. Only a missing JWT_SECRET stops the server
// (nothing can be signed safely without it); everything else is a loud
// warning so an existing deployment keeps running while it gets fixed.
// ─────────────────────────────────────────────────────────────────────────────

/** Pure: env → { fatal: [], warnings: [] } (unit-tested). */
export const checkSecurityConfig = (env = process.env) => {
  const fatal = [], warnings = [];
  const get = (k) => (typeof env[k] === "string" ? env[k].trim() : "");
  const prod = get("NODE_ENV") === "production";
  const secret = get("JWT_SECRET");

  if (!secret) fatal.push("JWT_SECRET is not set — no login token can be signed safely.");
  else if (secret.length < 48 || new Set(secret).size < 16)
    warnings.push("JWT_SECRET is short or low-variety — use a random value of 64+ characters (see .env.example).");

  const sms = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE"].every((k) => get(k))
    || ["MSG91_AUTH_KEY", "MSG91_SENDER_ID", "MSG91_TEMPLATE_ID"].every((k) => get(k));
  if (prod && !sms)
    warnings.push("No SMS provider (Twilio / MSG91) — staff SMS-OTP login (Kitchen app) cannot work; codes only appear in the server log.");
  if (get("OTP_DEV_ECHO") === "true")
    warnings.push(prod ? "OTP_DEV_ECHO=true is IGNORED in production — remove it." : "OTP_DEV_ECHO=true — OTPs are returned in API responses (local testing only).");

  if (prod && !get("TZ"))
    warnings.push("TZ is not set — attendance / payroll days follow the server clock (UTC on most hosts). Set TZ=Asia/Kolkata.");
  if (prod && !["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].every((k) => get(k)))
    warnings.push("Firebase Admin is not fully configured — admin and customer phone login will fail.");
  const pp = ["PHONEPE_MERCHANT_ID", "PHONEPE_SALT_KEY"].filter((k) => get(k)).length;
  if (pp === 1) warnings.push("PhonePe is half-configured (need both PHONEPE_MERCHANT_ID and PHONEPE_SALT_KEY).");
  if (pp === 2 && prod && get("PHONEPE_ENV") !== "PROD")
    warnings.push("PhonePe is configured but PHONEPE_ENV is not PROD — real customers would be sent to the sandbox.");
  return { fatal, warnings };
};

export const runSecurityCheck = () => {
  const { fatal, warnings } = checkSecurityConfig();
  for (const w of warnings) console.warn(`⚠️  SECURITY CONFIG: ${w}`);
  if (fatal.length) {
    for (const f of fatal) console.error(`⛔ SECURITY CONFIG: ${f}`);
    process.exit(1);
  }
  if (!warnings.length) console.log("🔒 Security config check passed");
};

