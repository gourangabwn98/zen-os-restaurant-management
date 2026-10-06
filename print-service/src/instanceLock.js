// src/instanceLock.js
// ─────────────────────────────────────────────────────────────────────────────
// One print service per printer key on this PC. Two copies running at once
// (a second double-click, a startup shortcut + a manual start, the .exe in two
// folders) both receive every job and BOTH print it — every KOT and bill came
// out twice. The second copy now refuses to start and says why.
//
// The lock is a small file in the OS temp folder named after a hash of the
// printer key (never the key itself), holding the owner's PID. A lock left by
// a crashed run is ignored: the PID must still be alive AND be a print-service
// process (Windows recycles PIDs).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const lockPathFor = (printerKey, dir = os.tmpdir()) =>
  path.join(dir, `sohoj-print-${crypto.createHash("sha256").update(String(printerKey)).digest("hex").slice(0, 16)}.lock`);

/** Is `pid` a running process with this image name? (Windows: tasklist; elsewhere: kill 0.) */
const defaultIsRunning = (pid, imageName) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
      return out.toLowerCase().includes(`"${String(imageName).toLowerCase()}"`);
    } catch { return false; }
  }
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
};

/**
 * Take the lock, or report who holds it.
 * → { ok: true, release() } | { ok: false, pid }
 */
export const acquireInstanceLock = (printerKey, {
  dir, pid = process.pid, imageName = path.basename(process.execPath), isRunning = defaultIsRunning,
} = {}) => {
  const file = lockPathFor(printerKey, dir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid, imageName, startedAt: new Date().toISOString() }), { flag: "wx" });
      const release = () => {
        try {
          const cur = JSON.parse(fs.readFileSync(file, "utf8"));
          if (cur.pid === pid) fs.unlinkSync(file);
        } catch { /* already gone */ }
      };
      return { ok: true, release, file };
    } catch (err) {
      if (err.code !== "EEXIST") return { ok: true, release: () => {}, file: null }; // can't lock — never block printing
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* corrupt → stale */ }
      if (holder && holder.pid !== pid && isRunning(holder.pid, holder.imageName || imageName)) {
        return { ok: false, pid: holder.pid };
      }
      try { fs.unlinkSync(file); } catch { /* raced — retry */ }
    }
  }
  return { ok: true, release: () => {}, file: null };
};
