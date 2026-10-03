// test/otpGuard.test.js — run: node test/otpGuard.test.js
import assert from "node:assert/strict";
import { otpSendBlocked } from "../utils/otpGuard.js";

const t0 = 1_000_000_000_000;
assert.equal(otpSendBlocked("9000000001", t0), null);                       // first send
assert.match(otpSendBlocked("9000000001", t0 + 10_000), /wait 30 seconds/); // too soon
assert.equal(otpSendBlocked("9000000002", t0 + 10_000), null);              // other numbers unaffected
for (let i = 1; i <= 4; i++) assert.equal(otpSendBlocked("9000000001", t0 + i * 60_000), null);
assert.match(otpSendBlocked("9000000001", t0 + 5 * 60_000), /Too many/);    // 6th within the hour
assert.equal(otpSendBlocked("9000000001", t0 + 61 * 60_000 + 60_000), null); // an hour later: allowed again
console.log("otpGuard: all tests passed");
