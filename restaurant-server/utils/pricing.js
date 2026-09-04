// utils/pricing.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side order pricing. The client (customer/waiter/admin UI) sends only
// { menuItemId, qty, notes } for each line — price, name, tax etc. are always
// re-derived here from the live MenuItem + RestaurantProfile docs. Never trust
// a price/subtotal/total sent by a client.
// ─────────────────────────────────────────────────────────────────────────────

const qtyOf = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
};

/**
 * Resolves raw client line items [{ menuItemId, qty, notes }] into
 * authoritative order-item subdocuments, using ONLY prices from the DB.
 */
export const priceItems = async (items, MenuItem) => {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("No items in order");
    err.statusCode = 400;
    throw err;
  }

  return Promise.all(
    items.map(async (i) => {
      const qty = qtyOf(i.qty);
      if (!i.menuItemId) {
        const err = new Error("Each item requires a menuItemId");
        err.statusCode = 400;
        throw err;
      }
      if (qty === null) {
        const err = new Error(`Invalid quantity for item ${i.menuItemId}`);
        err.statusCode = 400;
        throw err;
      }

      const m = await MenuItem.findById(i.menuItemId);
      if (!m) {
        const err = new Error("Item not found. Please refresh menu.");
        err.statusCode = 400;
        throw err;
      }
      if (!m.isAvailable) {
        const err = new Error(`"${m.name}" is currently not available`);
        err.statusCode = 400;
        throw err;
      }

      return {
        menuItem: m._id,
        name: m.name,
        price: m.price,             // ← authoritative price, from DB, not client
        qty,
        notes: typeof i.notes === "string" ? i.notes.slice(0, 300) : "",
      };
    })
  );
};

/** Computes subtotal/tax/serviceCharge/total from already-resolved dbItems. */
export const computeTotals = (dbItems, restaurantProfile) => {
  const gstRate           = (restaurantProfile?.gstRate || 0) / 100;
  const serviceChargeRate = restaurantProfile?.serviceCharge || 0;
  const subtotal          = dbItems.reduce((s, i) => s + i.price * i.qty, 0);
  const totalQty          = dbItems.reduce((s, i) => s + i.qty, 0);
  const tax                = Math.round(subtotal * gstRate);
  const serviceCharge      = Math.round(serviceChargeRate * totalQty);
  const discount           = 0; // discounts are applied by staff server-side only, never client-supplied
  const total               = subtotal + tax + serviceCharge - discount;
  return { subtotal, tax, serviceCharge, discount, total, totalQty };
};

/**
 * Full convenience wrapper used by placeOrder: resolve + compute in one call.
 * @returns {{ dbItems, subtotal, tax, serviceCharge, discount, total, totalQty }}
 */
export const priceOrder = async ({ items, MenuItem, restaurantProfile }) => {
  const dbItems = await priceItems(items, MenuItem);
  const totals  = computeTotals(dbItems, restaurantProfile);
  return { dbItems, ...totals };
};
