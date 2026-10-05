// scripts/build-exe.mjs — `npm run build:exe`
// ─────────────────────────────────────────────────────────────────────────────
// Packs the print service into ONE Windows program, dist/SohojPrintService.exe,
// so the restaurant PC doesn't need Node.js or `npm install`. Uses Node's own
// Single Executable Application support (no third-party packager):
//   1. esbuild bundles src/ + node_modules into one CommonJS file
//   2. Node turns that into a SEA blob
//   3. the blob is injected into a copy of this machine's node.exe (postject)
// Then the files the .exe needs next to it (.env, printers.config.json,
// data/) are laid out in dist/ — see dist/README.txt.
//
// Build on Windows with the same Node major you want to ship (the .exe IS
// that node.exe). Config is NOT baked in: .env and printers.config.json are
// read from the .exe's folder at startup (src/config.js), so one build works
// for every restaurant.
// ─────────────────────────────────────────────────────────────────────────────
import { build } from "esbuild";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
// `npm run build:exe -- --out release` builds into another folder (e.g. a
// clean copy to send to a restaurant while dist/ is still running here).
const outArg = process.argv.indexOf("--out");
const DIST = path.resolve(ROOT, outArg > -1 && process.argv[outArg + 1] ? process.argv[outArg + 1] : "dist");
const EXE_NAME = "SohojPrintService.exe";
const EXE = path.join(DIST, EXE_NAME);
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"; // fixed by Node

if (process.platform !== "win32") {
  console.error("Build the .exe on Windows — it is made from this machine's node.exe.");
  process.exit(1);
}

const step = (msg) => console.log(`\n▶ ${msg}`);

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

step("Bundling src/index.js + dependencies");
const bundle = path.join(BUILD, "print-service.cjs");
await build({
  entryPoints: [path.join(ROOT, "src/index.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${process.versions.node.split(".")[0]}`,
  outfile: bundle,
  logLevel: "warning",
  // src/config.js only reads import.meta.url when NOT packaged — silence the
  // "import.meta is empty in cjs" warning for that unreachable branch.
  logOverride: { "empty-import-meta": "silent" },
});

step("Creating the single-executable blob");
const blob = path.join(BUILD, "sea-prep.blob");
const seaConfig = path.join(BUILD, "sea-config.json");
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false,
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

step(`Writing dist/${EXE_NAME}`);
try {
  fs.copyFileSync(process.execPath, EXE);
} catch (err) {
  if (err.code === "EBUSY" || err.code === "EPERM") {
    console.error(`\n${EXE_NAME} is in use — close the running print service first, then build again.`);
    process.exit(1);
  }
  throw err;
}
execFileSync(process.execPath, [
  path.join(ROOT, "node_modules/postject/dist/cli.js"),
  EXE, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE,
], { stdio: "inherit" });

step("Laying out the files the .exe needs next to it");
// Never overwrite a restaurant's real settings on a rebuild.
const copyIfMissing = (from, to) => { if (!fs.existsSync(to)) fs.copyFileSync(from, to); };
copyIfMissing(path.join(ROOT, ".env.example"), path.join(DIST, ".env"));
copyIfMissing(path.join(ROOT, "printers.config.json"), path.join(DIST, "printers.config.json"));
fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(DIST, ".env.example"));
fs.mkdirSync(path.join(DIST, "data"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "scripts/README-exe.txt"), path.join(DIST, "README.txt"));

// USB_DIRECT printers (src/drivers/usbDirectDriver.js) need the `usb`
// package's native binary, which can't live inside the single-executable
// blob — ship just the packages it loads at runtime next to the .exe.
for (const pkg of ["usb", "@node-usb/usb-win32-x64-msvc"]) {
  const to = path.join(DIST, "node_modules", pkg);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "node_modules", pkg), to, { recursive: true });
}

fs.rmSync(BUILD, { recursive: true, force: true });
const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ Done — ${path.relative(ROOT, EXE)} (${mb} MB)`);
console.log("   Copy the whole dist/ folder to the restaurant PC, fill in .env and printers.config.json, then run the .exe.");
