// scripts/check-i18n.mjs — `npm run i18n:check`
// Lists every literal string passed to t(), tn() or N_() in src/ that has no
// Bengali entry in src/i18n/bn/*. Exit code 1 when anything is missing.
// (Strings built at runtime can't be checked statically — keep them literal.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const { default: BN } = await import(new URL("../src/i18n/bn/index.js", import.meta.url));

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "i18n") walk(p); }
    else if (/\.(jsx?|mjs)$/.test(name)) files.push(p);
  }
};
walk(root);

const STR = String.raw`(["'\x60])((?:\\.|(?!\1)[^\\])*)\1`;
const single = new RegExp(String.raw`\b(?:t|N_)\(\s*` + STR, "g");
const plural = new RegExp(String.raw`\btn\([^,()]+(?:\([^()]*\))?[^,()]*,\s*` + STR + String.raw`\s*,\s*` + STR.replace(/\\1/g, "\\3"), "g");

const unescape = (s) => s.replace(/\\(["'\\`])/g, "$1").replace(/\\n/g, "\n");
const missing = new Map();
let total = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const keys = [];
  for (const m of src.matchAll(single)) if (m[1] !== "`" || !m[2].includes("${")) keys.push(m[2]);
  for (const m of src.matchAll(plural)) keys.push(m[2], m[4]);
  for (const raw of keys) {
    const k = unescape(raw);
    total++;
    if (!(k in BN)) {
      if (!missing.has(k)) missing.set(k, new Set());
      missing.get(k).add(relative(root, f));
    }
  }
}

// A local binding named `t` (a loop var, a total, a toast arg) in a file that
// imports the translator shadows it — t("…") then calls the wrong thing and
// crashes at runtime. ESLint allows shadowing, so check it here.
const SHADOW = [
  /\b(?:const|let|var)\s+t\s*=/,
  /\(([^()]*[,\s])?t(\s*,[^()]*)?\)\s*=>/,
  /(^|[^.\w$])t\s*=>/,
  /\bfunction\b[^(]*\(([^)]*[,\s])?t(\s*[,=][^)]*)?\)/,
  /\bcatch\s*\(\s*t\s*\)/,
];
const shadows = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["'][^"']*i18n\/core/.test(src)) continue;
  src.split(/\r?\n/).forEach((line, i) => {
    if (SHADOW.some((re) => re.test(line))) shadows.push(`${relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
if (shadows.length) {
  console.log("Local `t` shadows the translator (rename it):");
  shadows.forEach((s) => console.log("  " + s));
  console.log("");
}

if (missing.size || shadows.length) {
  if (!missing.size) process.exit(1);
  for (const [k, where] of missing) console.log(`${JSON.stringify(k)}   ← ${[...where].join(", ")}`);
  console.log(`\n${missing.size} missing Bengali entr${missing.size === 1 ? "y" : "ies"} (${total} t() calls checked)`);
  process.exit(1);
}
console.log(`All ${total} translatable strings have a Bengali entry.`);
