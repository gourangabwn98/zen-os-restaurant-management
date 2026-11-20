// utils/phonePeEnv.js
// ─────────────────────────────────────────────────────────────────────────────
// The ONE place that turns PHONEPE_ENV into a PhonePe environment. Used by
// services/paymentService.js (which host to call) AND config/securityCheck.js
// (start-up warnings), so the two can never disagree again.
//
// Why this exists: paymentService used to accept only "SANDBOX"/"PRODUCTION"
// and silently fall back to SANDBOX for anything else, while securityCheck
// told operators to set "PROD" — so following the warning sent real customers
// to the sandbox. Now:
//   • SANDBOX / UAT                → SANDBOX
//   • PRODUCTION / PROD / LIVE     → PRODUCTION
//   • blank                        → SANDBOX outside production; in production
//                                    (NODE_ENV=production) it must be explicit
//   • anything else                → invalid — the gateway is DISABLED (fail
//                                    closed), never guessed
// Pure, no dependencies.
// ─────────────────────────────────────────────────────────────────────────────

export const PHONEPE_ENVS = Object.freeze({ SANDBOX: "SANDBOX", PRODUCTION: "PRODUCTION" });

const ALIASES = Object.freeze({
  SANDBOX: PHONEPE_ENVS.SANDBOX,
  UAT: PHONEPE_ENVS.SANDBOX,
  PRODUCTION: PHONEPE_ENVS.PRODUCTION,
  PROD: PHONEPE_ENVS.PRODUCTION,
  LIVE: PHONEPE_ENVS.PRODUCTION,
});

/**
 * @param {object} env  process.env-like
 * @returns {{ env: "SANDBOX"|"PRODUCTION"|null, valid: boolean, explicit: boolean, reason: string }}
 *   `reason` is a human message when invalid (never contains a secret — only
 *   the PHONEPE_ENV value itself, which is not secret).
 */
export const resolvePhonePeEnv = (env = process.env) => {
  const raw = typeof env.PHONEPE_ENV === "string" ? env.PHONEPE_ENV.trim() : "";
  const prod = (typeof env.NODE_ENV === "string" ? env.NODE_ENV.trim() : "") === "production";

  if (!raw) {
    if (prod) {
      return { env: null, valid: false, explicit: false,
        reason: "PHONEPE_ENV is not set — in production it must be set explicitly to PRODUCTION (or SANDBOX)." };
    }
    return { env: PHONEPE_ENVS.SANDBOX, valid: true, explicit: false, reason: "" };
  }

  const mapped = ALIASES[raw.toUpperCase()];
  if (!mapped) {
    return { env: null, valid: false, explicit: true,
      reason: `PHONEPE_ENV="${raw}" is not recognised — use SANDBOX or PRODUCTION.` };
  }
  return { env: mapped, valid: true, explicit: true, reason: "" };
};
