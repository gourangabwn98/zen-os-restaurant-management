// utils/tenantKey.js
// ─────────────────────────────────────────────────────────────────────────────
// Derives a short, stable, non-secret identifier for a restaurant's database
// from its mongoUri. Used for Socket.IO room names and log lines so we never
// leak the raw connection string (which contains credentials) into rooms,
// logs, or socket payloads.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the database name segment from a Mongo connection string.
 * e.g. "mongodb+srv://user:pass@cluster.mongodb.net/kolhad_db?retryWrites=true"
 *   -> "kolhad_db"
 */
export const dbNameFromUri = (mongoUri) => {
  if (!mongoUri) return "unknown";
  try {
    const afterSlash = mongoUri.split("/").pop() || "";
    return afterSlash.split("?")[0] || "unknown";
  } catch {
    return "unknown";
  }
};

/** Canonical tenant key used everywhere (rooms, logs). Currently == dbName. */
export const tenantKeyFromUri = (mongoUri) => dbNameFromUri(mongoUri);

// ── Socket.IO room naming ──────────────────────────────────────────────────
export const rooms = {
  // Everyone connected for this restaurant (customers on this tenant + staff)
  tenant: (tenantKey) => `tenant:${tenantKey}`,
  // Admin + waiter only — order-approval alerts, payment/customer data,
  // KOT/bill jobs, dashboard pushes. Chefs are deliberately NOT in this
  // room (see `kitchen` below) — it carries data (payment status, guest
  // name/phone) a chef must never receive per RBAC.
  staff: (tenantKey) => `tenant:${tenantKey}:staff`,
  // Admin + chef — KOT creation and status-change events only. A narrower
  // room than `staff` specifically so the Kitchen app's realtime feed can
  // never leak payment/customer PII to a chef account.
  kitchen: (tenantKey) => `tenant:${tenantKey}:kitchen`,
  // Local printer-service clients for this tenant only
  printers: (tenantKey) => `tenant:${tenantKey}:printers`,
  // A single order's own updates (used so a guest/customer only gets their order)
  order: (tenantKey, orderId) => `tenant:${tenantKey}:order:${orderId}`,
};
