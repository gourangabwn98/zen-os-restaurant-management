import assert from "node:assert/strict";
import { getCounterDeskPhone } from "../services/waiterCallService.js";

const query = (value) => ({ select: () => ({ lean: async () => value }) });
const User = { findOne: () => query({ phone: "+919876543210" }) };
assert.equal(await getCounterDeskPhone({ User }), "+919876543210");
const Missing = { findOne: () => query(null) };
await assert.rejects(() => getCounterDeskPhone({ User: Missing }), /COUNTER DESK phone number is not configured/);
console.log("counter desk tests passed");
