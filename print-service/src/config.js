// src/config.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const readPrintersConfig = () => {
  const configPath = path.join(ROOT, "printers.config.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return raw.printers || [];
  } catch (err) {
    throw new Error(`Could not read printers.config.json: ${err.message}`);
  }
};

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

export const config = {
  backendUrl:  required("BACKEND_URL"),
  printerKey:  required("PRINTER_KEY"),
  queueFile:   path.resolve(ROOT, process.env.QUEUE_FILE || "./data/queue.json"),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 5),
  retryBaseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 3000),
  retrySweepIntervalMs: Number(process.env.RETRY_SWEEP_INTERVAL_MS || 15000),
  healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS || 20000),
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
