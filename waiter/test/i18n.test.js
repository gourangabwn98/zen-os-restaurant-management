// test/i18n.test.js — GLB-04 guard for the Waiter app's English / বাংলা.
// Every key used with t(), N_() or tn() in src/ (plus the label maps that
// are translated at render) must have a Bengali entry, and placeholders in
// the Bengali text must match the English ones.
//   node test/i18n.test.js
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const BN = (await import("../src/i18n/bn.js")).default;

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f)) files.push(p); } };
walk(SRC);

const keys = new Set();
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/\b(?:t|tr|N_)\(\s*(["`])((?:\\.|(?!\1).)*)\1/g)) if (!m[2].includes("${")) keys.add(m[2]);
  for (const m of s.matchAll(/\btn\([^,]+,\s*"([^"]*)",\s*"([^"]*)"/g)) { keys.add(m[1]); keys.add(m[2]); }
}
for (const f of ["components/StatusBadge.jsx", "utils/tableSession.js", "utils/dateRange.js"]) {
  const s = readFileSync(join(SRC, f), "utf8");
  for (const m of s.matchAll(/label:\s*"([^"]+)"/g)) keys.add(m[1]);
}

const missing = [...keys].filter((k) => BN[k] == null);
assert.deepEqual(missing, [], `Bengali missing for: ${missing.join(" | ")}`);

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const badVars = [...keys].filter((k) => vars(k) !== vars(BN[k]));
assert.deepEqual(badVars, [], `placeholder mismatch: ${badVars.join(" | ")}`);

console.log(`i18n.test.js: ${keys.size} keys, all translated with matching placeholders`);
