import twilio from "twilio";
import axios from "axios";

// ─── Choose your provider ─────────────────────────────────────────────────────
// Previously this picked the provider purely from NODE_ENV ("production" ->
// msg91, else -> console-only/no real SMS) — which meant a real deployment
// with Twilio credentials configured (but no MSG91 ones) would always try
// MSG91 anyway, fail, and every OTP send would error out with a generic
// "Failed to send OTP" message that gave no clue why.
//
// Instead: auto-detect from whichever credentials are actually present, so
// the provider actually configured is the one used, regardless of NODE_ENV.
// An explicit OTP_PROVIDER env var (twilio|msg91|console) always wins if set,
// for cases where more than one provider's credentials happen to be present
// and you want to force a specific one.
const resolveProvider = () => {
  const explicit = process.env.OTP_PROVIDER;
  if (["twilio", "msg91", "console"].includes(explicit)) return explicit;

  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE);
  const hasMsg91  = !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID && process.env.MSG91_TEMPLATE_ID);

  if (hasTwilio) return "twilio";
  if (hasMsg91)  return "msg91";

  // Neither is configured — falling back to console-only (no real SMS sent)
  // rather than throwing, so the server doesn't hard-crash on every OTP
  // request. This is only useful for local development.
  if (process.env.NODE_ENV === "production") {
    console.warn("⚠️  No OTP provider configured (TWILIO_* or MSG91_*) — OTPs will only be logged to the console, not actually sent. Employees/admin will not receive a real SMS.");
  }
  return "console";
};

const PROVIDER = resolveProvider();
console.log(`📨 OTP provider: ${PROVIDER}`);

/** Lets callers (e.g. the waiter/employee OTP endpoints) know when no real
 * SMS is actually being sent, so they can safely echo the OTP back in the
 * API response for testing — never done when a real provider is active. */
export const isConsoleProvider = () => PROVIDER === "console";

// ─── Twilio ───────────────────────────────────────────────────────────────────
const sendViaTwilio = async (phone, otp) => {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  await client.messages.create({
    body: `Your Adda Cafe OTP is ${otp}. Valid for 5 minutes. Do not share it with anyone.`,
    from: process.env.TWILIO_PHONE,
    to: `+91${phone}`,
  });

  console.log(`✅ Twilio OTP sent to +91${phone}`);
};

// ─── MSG91 (popular in India, cheaper than Twilio) ────────────────────────────
const sendViaMSG91 = async (phone, otp) => {
  const payload = {
    flow_id: process.env.MSG91_TEMPLATE_ID,
    sender: process.env.MSG91_SENDER_ID,
    mobiles: `91${phone}`,
    otp,
  };

  const { data } = await axios.post(
    "https://control.msg91.com/api/v5/flow/",
    payload,
    {
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        "content-type": "application/json",
      },
    },
  );

  if (data.type !== "success")
    throw new Error("MSG91 failed: " + JSON.stringify(data));
  console.log(`✅ MSG91 OTP sent to 91${phone}`);
};

// ─── Console (development fallback) ───────────────────────────────────────────
const sendViaConsole = async (phone, otp) => {
  console.log("─────────────────────────────────────");
  console.log(`📱 DEV MODE — OTP for ${phone}: ${otp}`);
  console.log("─────────────────────────────────────");
};

// ─── Main export ──────────────────────────────────────────────────────────────
const sendOTP = async (phone, otp) => {
  try {
    if (PROVIDER === "twilio") return await sendViaTwilio(phone, otp);
    if (PROVIDER === "msg91") return await sendViaMSG91(phone, otp);
    return await sendViaConsole(phone, otp); // default: dev
  } catch (err) {
    console.error(`❌ OTP send failed [${PROVIDER}]:`, err.message);
    throw new Error("Failed to send OTP. Please try again.");
  }
};

export default sendOTP;
