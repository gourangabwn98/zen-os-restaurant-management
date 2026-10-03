// test/securityCheck.test.js — run: node test/securityCheck.test.js
import assert from "node:assert/strict";
import { checkSecurityConfig } from "../config/securityCheck.js";

const strong = "a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ!@#$%^&*()_+qwertyuiopasdfgh";
const base = { NODE_ENV: "production", JWT_SECRET: strong, TZ: "Asia/Kolkata",
  TWILIO_ACCOUNT_SID: "x", TWILIO_AUTH_TOKEN: "y", TWILIO_PHONE: "z",
  FIREBASE_PROJECT_ID: "p", FIREBASE_CLIENT_EMAIL: "e", FIREBASE_PRIVATE_KEY: "k" };

let r = checkSecurityConfig(base);
assert.deepEqual(r, { fatal: [], warnings: [] }, "a complete production config passes");

r = checkSecurityConfig({ ...base, JWT_SECRET: "" });
assert.equal(r.fatal.length, 1);                                  // missing secret is fatal
r = checkSecurityConfig({ ...base, JWT_SECRET: "mysecretkey12345mysecretkey12345" });
assert.ok(r.warnings.some((w) => /JWT_SECRET/.test(w)));          // low-variety secret warns
r = checkSecurityConfig({ ...base, TWILIO_PHONE: "" });
assert.ok(r.warnings.some((w) => /SMS provider/.test(w)));
r = checkSecurityConfig({ ...base, TZ: "" });
assert.ok(r.warnings.some((w) => /TZ is not set/.test(w)));
r = checkSecurityConfig({ ...base, OTP_DEV_ECHO: "true" });
assert.ok(r.warnings.some((w) => /IGNORED in production/.test(w)));
r = checkSecurityConfig({ ...base, PHONEPE_MERCHANT_ID: "m" });
assert.ok(r.warnings.some((w) => /half-configured/.test(w)));
r = checkSecurityConfig({ ...base, PHONEPE_MERCHANT_ID: "m", PHONEPE_SALT_KEY: "s", PHONEPE_ENV: "UAT" });
assert.ok(r.warnings.some((w) => /sandbox/.test(w)));
r = checkSecurityConfig({ NODE_ENV: "development", JWT_SECRET: strong });
assert.deepEqual(r.warnings, [], "dev without SMS/TZ is fine");
const out = JSON.stringify(checkSecurityConfig({ ...base, JWT_SECRET: "Zq9xKwVb" }));
assert.ok(!out.includes("Zq9xKwVb"), "never prints the secret");
console.log("securityCheck: all tests passed");
