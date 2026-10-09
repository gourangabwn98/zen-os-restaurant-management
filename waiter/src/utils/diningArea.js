// Dining areas (KH-10) + table areas. Mirrors
// restaurant-server/utils/diningArea.js: a table belongs to one area ("" =
// Indoor); a dine-in order takes its area from its table (server-side).
// Never hardcode the values elsewhere.
import { N_, t } from "../i18n/index.jsx";

export const DINING_AREAS = ["AC_ROOM", "GARDEN", "GAZEBO"];
export const DINING_AREA_AC_ROOM = DINING_AREAS[0]; // "Indoor-AC" — the only area with a per-guest charge
export const DINING_AREA_LABEL = { AC_ROOM: N_("Indoor-AC"), GARDEN: N_("Garden"), GAZEBO: N_("Gazebo") };
export const TABLE_AREA_LABEL = { "": N_("Indoor"), ...DINING_AREA_LABEL };

/**
 * KH-11: an Indoor-AC table — the only area with a per-guest charge. A new
 * staff order there needs the guest count (the server enforces it and adds
 * guests × rate to the subtotal), once per table visit.
 */
export const isAcRoom = (x) => (x?.diningArea || "") === DINING_AREA_AC_ROOM;

/**
 * What people call a table — or a dine-in order's / waiter call's table:
 * "Indoor-AC 1", its number WITHIN its area. Never show the bare internal
 * tableNo (Indoor-AC 1 may be internal table 15). Works on a table
 * (displayNo, from GET /admin/tables) and on an order (tableDisplayNo /
 * tableName snapshot). Older records without a per-area number: "Table 15".
 */
export const tableLabel = (x) => {
  if (!x) return "";
  const n = x.displayNo ?? x.tableDisplayNo;
  if (n != null && n !== "") return `${t(TABLE_AREA_LABEL[x.diningArea || ""] || TABLE_AREA_LABEL[""])} ${n}`;
  if (x.tableName) return x.tableName;
  return x.tableNo ? t("Table {n}", { n: x.tableNo }) : "";
};

/** tableLabel for a bare internal tableNo, looked up in the tables list. */
export const tableLabelByNo = (tables, tableNo) =>
  tableLabel((tables || []).find((tb) => Number(tb.tableNo) === Number(tableNo)) || { tableNo });

/**
 * Tables → [{ area, tables }] in the order the SERVER sent them (GET
 * /admin/tables sorts by area, then table number) — the same groups, in the
 * same order, as the admin's Table Map.
 */
export const groupTablesByArea = (tables) => {
  const groups = [];
  for (const t of tables) {
    const area = t.diningArea || "";
    let g = groups.find((x) => x.area === area);
    if (!g) { g = { area, tables: [] }; groups.push(g); }
    g.tables.push(t);
  }
  return groups;
};
