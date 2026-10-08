// utils/diningArea.js — dining areas + table areas
// ─────────────────────────────────────────────────────────────────────────────
// Where a DINE_IN order is seated. Stored on Order.diningArea (and copied to
// its KOTJob / bill payload). Deliberately NOT a new ORDER_TYPES value: an
// Indoor-AC / Garden / Gazebo order is a normal dine-in order with a table, so
// every existing DINE_IN rule (table required, table session, filters,
// reports) keeps working unchanged. "" = Indoor, the normal hall (all old
// orders). Never hardcode the values elsewhere — import these.
//
// The stored value for Indoor-AC stays "AC_ROOM" (older orders and the
// AC service charge — services/acServiceCharge.js — use it); only its label
// changed to "Indoor-AC".
// ─────────────────────────────────────────────────────────────────────────────

export const DINING_AREAS = ["AC_ROOM", "GARDEN", "GAZEBO"];
export const DINING_AREA_AC_ROOM = DINING_AREAS[0];
export const DINING_AREA_LABEL = { AC_ROOM: "Indoor-AC", GARDEN: "Garden", GAZEBO: "Gazebo" };

/** The area to store: a known area on a DINE_IN order, otherwise "". */
export const normalizeDiningArea = (value, orderType) =>
  orderType === "DINE_IN" && DINING_AREAS.includes(value) ? value : "";

// ── Table areas (Table Management) ──────────────────────────────────────────
// A table belongs to one area — the SAME values ("" = Indoor). The admin
// sets it on the table; a dine-in order's area is taken from its table
// server-side (orderService.placeOrderTx), so every map / KOT / bill /
// Indoor-AC service charge follows it.
//
// Table NUMBERS are per area (Indoor 1–10, Indoor-AC 1–6, Garden 1–5,
// Gazebo 1–3): Table.displayNo. Every table also keeps its own unique
// internal Table.tableNo — the key orders, table sessions, QR codes, combined
// bills and the waitlist already use — so none of that logic changes.
// Older tables have no displayNo: their number is their tableNo.
export const TABLE_AREAS = ["", ...DINING_AREAS]; // also the order areas are shown in
export const TABLE_AREA_LABEL = { "": "Indoor", ...DINING_AREA_LABEL };

/** Admin input → a stored table area. undefined = leave unchanged; 400 if unknown. */
export const normalizeTableArea = (value) => {
  if (value === undefined) return undefined;
  const v = value === null ? "" : String(value);
  if (!TABLE_AREAS.includes(v)) {
    throw Object.assign(new Error(`Area must be one of: ${TABLE_AREAS.map((a) => TABLE_AREA_LABEL[a]).join(", ")}`), { statusCode: 400 });
  }
  return v;
};

/** A table's number within its area (older tables: their tableNo). */
export const tableDisplayNo = (t) => Number(t?.displayNo ?? t?.tableNo);

/** "Indoor-AC 1" — what people see / what prints for a table. */
export const tableDisplayName = (area, displayNo) => `${TABLE_AREA_LABEL[area || ""] || "Indoor"} ${displayNo}`;

/**
 * The ONE ordering every table map uses (admin + waiter render it as-is):
 * areas in the fixed order Indoor → Indoor-AC → Garden → Gazebo, tables by
 * their number inside an area. A new Garden 6 lands at the end of Garden —
 * no frontend change needed.
 */
export const sortTablesByArea = (tables) => {
  const rank = (t) => {
    const i = TABLE_AREAS.indexOf(t.diningArea || "");
    return i < 0 ? TABLE_AREAS.length : i;
  };
  return [...tables].sort((x, y) => rank(x) - rank(y) || tableDisplayNo(x) - tableDisplayNo(y) || Number(x.tableNo) - Number(y.tableNo));
};
