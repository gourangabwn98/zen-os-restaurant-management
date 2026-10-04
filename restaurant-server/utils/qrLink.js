// utils/qrLink.js
// ─────────────────────────────────────────────────────────────────────────────
// TBL-01 — a table QR must open the customer app directly. It is a plain https
// URL to the customer PWA (`/?table=N&t=<token>`): phone cameras open a URL in
// one tap, but a non-URL payload (e.g. "undefined/?table=3&t=…" when
// CUSTOMER_FRONTEND_URL was missing, or a relative path) is shown as text and
// the customer has to copy/search it — the "extra step" the client saw.
// So: the base must be an absolute http(s) URL, or no QR is made at all; and a
// table whose stored QR points somewhere else is reported as stale so the admin
// can fix it from the Tables screen.
// ─────────────────────────────────────────────────────────────────────────────

/** The customer app's origin (+ optional path), no trailing slash — or null. */
const parseBase = (raw) => {
  try {
    const u = new URL(String(raw || "").trim());
    return /^https?:$/.test(u.protocol) ? { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, local: /^(localhost|127\.0\.0\.1)$/.test(u.hostname) } : null;
  } catch { return null; }
};

/** CUSTOMER_FRONTEND_URL when it is a real URL; else the first public entry
 * of CLIENT_URL (comma list, may include dev localhost origins); else null. */
export const customerBaseUrl = (env = process.env) => {
  const own = parseBase(env.CUSTOMER_FRONTEND_URL);
  if (own) return own.url;
  const list = String(env.CLIENT_URL || "").split(",").map(parseBase).filter(Boolean);
  return (list.find((b) => !b.local) || list[0])?.url || null;
};

export const tableQrUrl = (base, tableNo, token) => `${base}/?table=${encodeURIComponent(tableNo)}&t=${encodeURIComponent(token)}`;
export const takeawayQrUrl = (base) => `${base}/?mode=takeaway`;

/** True when the stored QR doesn't open the current customer app with the table's token. */
export const isQrStale = (table, base) => {
  if (!base) return false; // nothing to compare against — reported separately
  if (!table?.qrUrl || !table.qrToken) return true;
  return table.qrUrl !== tableQrUrl(base, table.tableNo, table.qrToken);
};

export const qrBaseMissingError = () => Object.assign(
  new Error("The customer app address is not set on the server (CUSTOMER_FRONTEND_URL) — QR codes can't be made until it is"),
  { statusCode: 503 },
);
