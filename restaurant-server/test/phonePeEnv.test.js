// test/phonePeEnv.test.js — run: node test/phonePeEnv.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Regression: PHONEPE_ENV used to be read two different ways — paymentService
// accepted only SANDBOX/PRODUCTION (anything else silently → sandbox) while
// securityCheck told operators to set "PROD". Following the warning sent real
// customers to the sandbox. Both now go through utils/phonePeEnv.js, and an
// unknown value disables the gateway instead of guessing.
// No network: only host selection / configuration is checked.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { resolvePhonePeEnv, PHONEPE_ENVS } from "../utils/phonePeEnv.js";

const { isPhonePeConfigured, phonePeTarget, PHONEPE_HOSTS } = await import("../services/paymentService.js");

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}\n         ${err.message}`); }
};

// Run fn with a temporary process.env patch, restoring afterwards.
const withEnv = (patch, fn) => {
  const keys = ["NODE_ENV", "PHONEPE_ENV", "PHONEPE_MERCHANT_ID", "PHONEPE_SALT_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, patch);
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};
const CREDS = { PHONEPE_MERCHANT_ID: "TESTMERCHANT", PHONEPE_SALT_KEY: "test-salt" };

console.log("── resolvePhonePeEnv ──────────────────────────");
for (const v of ["PRODUCTION", "PROD", "prod", "Production", " LIVE "]) {
  test(`"${v}" → PRODUCTION`, () => assert.equal(resolvePhonePeEnv({ PHONEPE_ENV: v }).env, PHONEPE_ENVS.PRODUCTION));
}
for (const v of ["SANDBOX", "sandbox", "UAT"]) {
  test(`"${v}" → SANDBOX`, () => assert.equal(resolvePhonePeEnv({ PHONEPE_ENV: v }).env, PHONEPE_ENVS.SANDBOX));
}
test("blank outside production → SANDBOX (local dev default)", () => {
  const r = resolvePhonePeEnv({ NODE_ENV: "development" });
  assert.equal(r.valid, true); assert.equal(r.env, PHONEPE_ENVS.SANDBOX); assert.equal(r.explicit, false);
});
test("blank in production → invalid (must be explicit)", () => {
  const r = resolvePhonePeEnv({ NODE_ENV: "production", PHONEPE_ENV: "  " });
  assert.equal(r.valid, false); assert.equal(r.env, null);
});
for (const v of ["PRD", "PRODUCTON", "TEST", "1", "hermes"]) {
  test(`unknown "${v}" → invalid, never a guessed environment`, () => {
    const r = resolvePhonePeEnv({ PHONEPE_ENV: v });
    assert.equal(r.valid, false); assert.equal(r.env, null); assert.match(r.reason, /not recognised/);
  });
}

console.log("── paymentService host selection ──────────────");
test("PROD selects the PRODUCTION host (was: silently the sandbox)", () => withEnv({ ...CREDS, PHONEPE_ENV: "PROD" }, () => {
  assert.equal(phonePeTarget().host, PHONEPE_HOSTS.PRODUCTION);
  assert.equal(isPhonePeConfigured(), true);
}));
test("PRODUCTION selects the PRODUCTION host", () => withEnv({ ...CREDS, PHONEPE_ENV: "PRODUCTION" }, () => {
  assert.equal(phonePeTarget().host, PHONEPE_HOSTS.PRODUCTION);
}));
test("SANDBOX selects the sandbox host", () => withEnv({ ...CREDS, PHONEPE_ENV: "SANDBOX" }, () => {
  assert.equal(phonePeTarget().host, PHONEPE_HOSTS.SANDBOX);
  assert.notEqual(PHONEPE_HOSTS.SANDBOX, PHONEPE_HOSTS.PRODUCTION);
}));
test("unknown value disables the gateway (no host, not configured)", () => withEnv({ ...CREDS, PHONEPE_ENV: "PRD" }, () => {
  assert.equal(phonePeTarget().host, null);
  assert.equal(isPhonePeConfigured(), false);
}));
test("production with blank PHONEPE_ENV disables the gateway", () => withEnv({ ...CREDS, NODE_ENV: "production" }, () => {
  assert.equal(isPhonePeConfigured(), false);
}));
test("valid env but no credentials → not configured", () => withEnv({ PHONEPE_ENV: "PRODUCTION" }, () => {
  assert.equal(isPhonePeConfigured(), false);
}));
test("target never exposes a secret", () => withEnv({ ...CREDS, PHONEPE_ENV: "SANDBOX" }, () => {
  assert.ok(!JSON.stringify(phonePeTarget()).includes(CREDS.PHONEPE_SALT_KEY));
}));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
