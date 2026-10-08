// utils/diningArea.js — KH-10
// ─────────────────────────────────────────────────────────────────────────────
// Where a DINE_IN order is seated. Stored on Order.diningArea (and copied to
// its KOTJob / bill payload). Deliberately NOT a new ORDER_TYPES value: an
// AC Room / Garden order is a normal dine-in order with a table, so every
// existing DINE_IN rule (table required, table session, filters, reports)
// keeps working unchanged. "" = the normal dining hall (all old orders).
// Never hardcode "AC_ROOM" / "GARDEN" elsewhere — import these.
// ─────────────────────────────────────────────────────────────────────────────

export const DINING_AREAS = ["AC_ROOM", "GARDEN"];
export const DINING_AREA_AC_ROOM = DINING_AREAS[0];
export const DINING_AREA_LABEL = { AC_ROOM: "AC Room", GARDEN: "Garden" };

/** The area to store: a known area on a DINE_IN order, otherwise "". */
export const normalizeDiningArea = (value, orderType) =>
  orderType === "DINE_IN" && DINING_AREAS.includes(value) ? value : "";
