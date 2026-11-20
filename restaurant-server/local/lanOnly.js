// local/lanOnly.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition: endpoints meant only for devices on the restaurant's own
// network (health, later device pairing). Decides from the TCP peer address
// (req.socket.remoteAddress) — NEVER from X-Forwarded-For or any header a
// client can set. The local server has no reverse proxy in front of it.
// ─────────────────────────────────────────────────────────────────────────────

/** Pure: true for loopback, RFC 1918, link-local and IPv6 ULA/link-local addresses. */
export const isPrivateAddress = (raw) => {
  let ip = String(raw || "").trim().toLowerCase();
  if (!ip) return false;
  if (ip.startsWith("::ffff:")) ip = ip.slice(7); // IPv4-mapped IPv6 (how Node reports IPv4 on a dual-stack socket)

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return a === 127                          // loopback
      || a === 10                             // 10.0.0.0/8
      || (a === 172 && b >= 16 && b <= 31)    // 172.16.0.0/12
      || (a === 192 && b === 168)             // 192.168.0.0/16
      || (a === 169 && b === 254);            // link-local
  }
  if (ip === "::1") return true;                       // IPv6 loopback
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;      // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;      // fe80::/10 link-local
  return false;
};

/** Express middleware: 403 for any peer outside the private ranges above. */
export const requireLan = (req, res, next) => {
  if (isPrivateAddress(req.socket?.remoteAddress)) return next();
  return res.status(403).json({ message: "Only available on the restaurant network" });
};

/** Pure: true only for this machine itself (127.0.0.0/8, ::1, IPv4-mapped loopback). */
export const isLoopbackAddress = (raw) => {
  let ip = String(raw || "").trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
};

/** Express middleware: 403 unless the request comes from the restaurant PC itself. */
export const requireLoopback = (req, res, next) => {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return next();
  return res.status(403).json({ message: "First-time setup can only be done on the restaurant PC itself (open the admin app on this PC: http://localhost:8081)", code: "SETUP_LOOPBACK_ONLY" });
};
