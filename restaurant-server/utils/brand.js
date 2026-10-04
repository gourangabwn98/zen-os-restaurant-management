// utils/brand.js
// ─────────────────────────────────────────────────────────────────────────────
// GLB-01/02 — the one place server-side text gets the restaurant's name when
// no RestaurantProfile value is at hand (SMS, test messages). The profile in
// the database stays the source of truth for everything an admin can edit;
// this is only the fallback, and it must never be another client's name.
// Override per deployment with BRAND_NAME in .env.
// ─────────────────────────────────────────────────────────────────────────────
export const BRAND_NAME = (process.env.BRAND_NAME || "Hotel KHOAI").trim();

/** Profile name when set, else the deployment's brand name. */
export const restaurantDisplayName = (profile) => (profile?.restaurantName || "").trim() || BRAND_NAME;
