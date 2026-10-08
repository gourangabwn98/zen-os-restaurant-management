// KH-10 — where a dine-in order is seated. Mirrors
// restaurant-server/utils/diningArea.js: stored as order.diningArea on a
// DINE_IN order ("" = normal hall). Never hardcode the values elsewhere.
import { N_ } from "../i18n/index.jsx";

export const DINING_AREAS = ["AC_ROOM", "GARDEN"];
export const DINING_AREA_LABEL = { AC_ROOM: N_("AC Room"), GARDEN: N_("Garden") };
export const DINING_AREA_ICON = { "": "🍽️", AC_ROOM: "❄️", GARDEN: "🌳" };
