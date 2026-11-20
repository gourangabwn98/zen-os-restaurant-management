// utils/localPin.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition staff PINs: rules + hashing. No plaintext PIN is ever
// stored, logged or returned — callers must never pass a PIN to console/audit.
//
// Hash: scrypt (Node built-in, memory-hard; no extra dependency) over
//   HMAC-SHA256(LOCAL_PIN_PEPPER, pin)
// with a per-PIN random salt. A 6–8 digit PIN has at most 10^8 values, so a
// stolen hash alone would eventually fall to brute force. The pepper lives
// only in the PC's .env, NOT in the database: a copied database (or a
// leaked backup) without the .env cannot be brute-forced. Online guessing is
// stopped by device binding + lockout (services/localAuthService.js).
//
// Stored format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64> — parameters are
// kept with each hash so they can be raised later without breaking old PINs.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

export const PIN_MIN = 6;
export const PIN_MAX = 8;
const SCRYPT = Object.freeze({ N: 1 << 15, r: 8, p: 1, keylen: 32 }); // ≈32 MiB, ~50–100 ms per check
const MAXMEM = 96 * 1024 * 1024;

const scryptAsync = (password, salt, { N, r, p, keylen }) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
});

const pepperOf = (env) => {
  const pepper = typeof env.LOCAL_PIN_PEPPER === "string" ? env.LOCAL_PIN_PEPPER.trim() : "";
  if (pepper.length < 32) throw Object.assign(new Error("LOCAL_PIN_PEPPER is not configured"), { statusCode: 503 });
  return pepper;
};
const peppered = (pin, env) => crypto.createHmac("sha256", pepperOf(env)).update(String(pin), "utf8").digest();

/** Pure: is this string shaped like a PIN at all? (digits, length) */
export const isPinShaped = (pin) => typeof pin === "string" && new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

/**
 * Pure: PIN rules. Returns null when acceptable, else a user-facing reason.
 * Blocks the guesses people try first: one repeated digit, straight runs,
 * and the phone number's own digits.
 */
export const pinProblem = (pin, { phone = "" } = {}) => {
  if (!isPinShaped(pin)) return `PIN must be ${PIN_MIN}–${PIN_MAX} digits`;
  if (/^(\d)\1+$/.test(pin)) return "PIN can't be one repeated digit";
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if (Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) return "PIN can't be a straight run like 123456";
  const phoneDigits = String(phone).replace(/\D/g, "");
  if (phoneDigits && (phoneDigits.endsWith(pin) || phoneDigits.startsWith(pin))) return "PIN can't be part of your phone number";
  return null;
};

/** Hash a PIN for storage. Throws (503) when the pepper is missing. */
export const hashPin = async (pin, env = process.env) => {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(peppered(pin, env), salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
};

/** Constant-time check of a PIN against a stored hash. Malformed hash → false. */
export const verifyPin = async (pin, stored, env = process.env) => {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const key = await scryptAsync(peppered(String(pin ?? ""), env), salt, { N, r, p, keylen: expected.length });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
};

// Unknown phone / no PIN: still spend one scrypt so response time doesn't
// reveal which phone numbers are staff.
let dummyHash = null;
export const burnPinCheck = async (env = process.env) => {
  if (!dummyHash) dummyHash = await hashPin(crypto.randomInt(10 ** 7, 10 ** 8).toString(), env);
  await verifyPin("00000000", dummyHash, env);
  return false;
};

// ── Device secrets / one-time codes (high entropy → plain SHA-256 is right) ──
export const randomHex = (bytes) => crypto.randomBytes(bytes).toString("hex");
export const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
export const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ""), "hex"), y = Buffer.from(String(b || ""), "hex");
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Human-typable codes: no 0/O/1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const humanCode = (length) => Array.from({ length }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
/** Normalise a typed human code: uppercase, drop spaces/dashes. */
export const normalizeHumanCode = (v) => String(v ?? "").toUpperCase().replace(/[\s-]/g, "");
