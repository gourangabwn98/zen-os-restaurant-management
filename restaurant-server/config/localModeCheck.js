// config/localModeCheck.js
// ─────────────────────────────────────────────────────────────────────────────
// Startup check for the Offline Edition (config/deploymentMode.js).
// Kept separate from securityCheck.js so the cloud check is untouched.
//
// CLOUD_PRIMARY: returns nothing (cloud behaviour is unchanged). The only
// cloud-side failure is an UNKNOWN DEPLOYMENT_MODE value, which must stop
// the server rather than be guessed.
// LOCAL_PRIMARY: refuses to start with a database that isn't a replica set
// on this PC, or with test-only shortcuts that would be unsafe on a real
// restaurant's Wi-Fi. Never prints a secret value.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveDeploymentMode, checkLocalMongoUri, DEPLOYMENT_MODES } from "./deploymentMode.js";

// Same rule as services/localAuthService.js isValidSiteId (kept here so this
// startup check doesn't import the auth service and its dependencies).
const isValidSiteId = (v) => /^[a-z0-9][a-z0-9-]{2,39}$/.test(v);

// The secret scripts/localSandbox.js uses — public in this repo.
const SANDBOX_JWT_SECRET = "zen-sandbox-only-secret-not-for-production";

/** Pure: env → { mode, fatal: [], warnings: [] } (unit-tested). */
export const checkLocalModeConfig = (env = process.env) => {
  const fatal = [], warnings = [];
  const resolved = resolveDeploymentMode(env);
  if (!resolved.valid) return { mode: null, fatal: [resolved.reason], warnings };
  if (resolved.mode !== DEPLOYMENT_MODES.LOCAL_PRIMARY) return { mode: resolved.mode, fatal, warnings };

  const get = (k) => (typeof env[k] === "string" ? env[k].trim() : "");

  for (const p of checkLocalMongoUri(env.MONGO_URI).problems) fatal.push(p);

  if (get("JWT_SECRET") === SANDBOX_JWT_SECRET)
    fatal.push("JWT_SECRET is the public sandbox secret — generate a new random one for this restaurant.");
  // On a real restaurant LAN, OTP echo would hand any phone on the Wi-Fi a
  // staff login. authController ignores it only when NODE_ENV=production,
  // and a restaurant PC may not set that — so refuse it here outright.
  if (get("OTP_DEV_ECHO") === "true")
    fatal.push("OTP_DEV_ECHO=true is not allowed in the Offline Edition — it returns login codes to anyone on the Wi-Fi.");

  // The local server is the authority: auto-send to kitchen, pay-first
  // expiry and delivery ticks have no other place to run.
  if (get("DISABLE_BACKGROUND_JOBS") === "true")
    warnings.push("DISABLE_BACKGROUND_JOBS=true — orders will not auto-send to the kitchen. The Offline Edition server is the only place these jobs run; remove it.");

  // O2 staff PIN login (services/localAuthService.js, utils/localPin.js).
  // The pepper keeps PIN hashes un-brute-forceable from a copied database, so
  // it must be long, random, and NOT the JWT secret (a leaked token key must
  // not also unlock the PIN hashes).
  const pepper = get("LOCAL_PIN_PEPPER");
  if (pepper.length < 32)
    fatal.push("LOCAL_PIN_PEPPER is missing or shorter than 32 characters — staff PIN login cannot work without it. Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  else if (pepper === get("JWT_SECRET"))
    fatal.push("LOCAL_PIN_PEPPER must be different from JWT_SECRET.");
  if (!isValidSiteId(get("LOCAL_SITE_ID").toLowerCase()))
    fatal.push("LOCAL_SITE_ID is missing or invalid — use 3–40 lowercase letters, digits or dashes (e.g. adds-cafe-kolkata). First-time setup asks for it.");
  const hours = get("LOCAL_SESSION_HOURS");
  if (hours && !(Number(hours) >= 1 && Number(hours) <= 24))
    warnings.push(`LOCAL_SESSION_HOURS must be 1–24 — using ${Math.min(24, Math.max(1, Number(hours) || 12))} instead.`);

  return { mode: resolved.mode, fatal, warnings };
};

export const runLocalModeCheck = () => {
  const { mode, fatal, warnings } = checkLocalModeConfig();
  for (const w of warnings) console.warn(`⚠️  LOCAL MODE: ${w}`);
  if (fatal.length) {
    for (const f of fatal) console.error(`⛔ DEPLOYMENT CONFIG: ${f}`);
    process.exit(1);
  }
  if (mode === DEPLOYMENT_MODES.LOCAL_PRIMARY) console.log("🏠 Offline Edition: DEPLOYMENT_MODE=LOCAL_PRIMARY");
  return mode;
};
