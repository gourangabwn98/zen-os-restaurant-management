// middleware/rateLimit.js
// ─────────────────────────────────────────────────────────────────────────────
// Tiny fixed-window rate limiter (no dependency). Per process — with several
// server instances each allows `max`, which is fine for abuse damping (GPS
// floods, tracking-link scraping, OTP guessing); the hard limits (OTP
// attempts, capacity) are enforced in the database, not here.
// ─────────────────────────────────────────────────────────────────────────────

export const rateLimit = ({ windowMs, max, key = (req) => String(req.user?._id || req.ip), message = "Too many requests — slow down" }) => {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; hits.set(k, entry); }
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message, code: "RATE_LIMITED" });
    }
    next();
  };
};
