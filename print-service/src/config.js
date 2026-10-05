// src/config.js
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Where .env, printers.config.json and data/ live. Run with Node (`npm
// start`) that's this project folder; run as the packaged .exe
// (scripts/build-exe.mjs) it's the folder the .exe sits in — so the .exe
// can be copied anywhere with its config files next to it.
const PACKAGED = !["node", "node.exe"].includes(path.basename(process.execPath).toLowerCase());
const ROOT = PACKAGED
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Explicit path, not the working directory — a shortcut or Task Scheduler
// may start the .exe from somewhere else.
dotenv.config({ path: path.join(ROOT, ".env") });

const readPrintersConfig = () => {
  const configPath = path.join(ROOT, "printers.config.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return raw.printers || [];
  } catch (err) {
    throw new Error(`Could not read ${configPath}: ${err.message}`);
  }
};

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required setting ${name} — add it to ${path.join(ROOT, ".env")}`);
  return v;
};

// The server ORIGIN. A URL ending in /api (the apps' VITE_API_URL style) makes
// Socket.IO treat "/api" as a namespace: the connection is refused with
// "Invalid namespace" and nothing ever prints — so it is stripped here.
export const normalizeBackendUrl = (url) => String(url || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");

export const config = {
  backendUrl:  normalizeBackendUrl(required("BACKEND_URL")),
  printerKey:  required("PRINTER_KEY"),
  queueFile:   path.resolve(ROOT, process.env.QUEUE_FILE || "./data/queue.json"),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 10),
  retryBaseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 3000),
  // How often waiting/failed jobs are looked at. Fast on purpose: a waiting
  // job prints within seconds of its printer coming back; FAILED jobs still
  // back off (RETRY_BASE_DELAY_MS × 2^n, max 60 s — queue.getRetryable).
  retrySweepIntervalMs: Number(process.env.RETRY_SWEEP_INTERVAL_MS || 3000),
  healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS || 5000),
  // Bill logo (Admin → Profile logo): max size in printer dots — a 58 mm
  // roll is ~384 dots wide, 80 mm ~576. LOGO_INVERT: auto | true | false.
  logoWidth:  Number(process.env.LOGO_WIDTH || 192),
  logoHeight: Number(process.env.LOGO_HEIGHT || 160),
  logoInvert: ({ true: true, false: false })[String(process.env.LOGO_INVERT || "auto").toLowerCase()] ?? "auto",
  printLogo:  String(process.env.PRINT_LOGO || "true").toLowerCase() !== "false",
  // Last line of the bill, under "Thank you! Visit again :)". Empty = none.
  billFooter: process.env.BILL_FOOTER ?? "Powered by Zen OS",
  // "Scan & Pay" QR at the bottom of unpaid bills (src/payQr.js).
  // Windows font used to print Bengali/Hindi/other non-Latin text as images.
  unicodeFont: process.env.UNICODE_FONT || "Nirmala UI",
  printPayQr: String(process.env.PRINT_PAY_QR || "true").toLowerCase() !== "false",
  payQrSize:  Number(process.env.PAY_QR_SIZE || 240), // dots; ~30 mm
  // Safety net for a live push that never arrived (job created on another
  // server instance, or during a reconnect) — one small socket call.
  queuePollIntervalMs: Number(process.env.QUEUE_POLL_INTERVAL_MS || 5000),
  useMockPrinter: String(process.env.USE_MOCK_PRINTER || "false").toLowerCase() === "true",
  printers: readPrintersConfig(),
};

export const getPrinterConfigForRole = (role) => {
  // Prefer an exact-role match, then a BOTH-role printer as fallback.
  return (
    config.printers.find((p) => p.role === role) ||
    config.printers.find((p) => p.role === "BOTH")
  );
};
