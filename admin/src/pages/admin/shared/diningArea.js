// src/pages/admin/shared/diningArea.js — KH-10
// Where a dine-in order is seated. Mirrors restaurant-server/utils/diningArea.js:
// order.diningArea on a DINE_IN order, "" = the normal hall (all old orders).
import { N_ } from "../../../i18n/core.js";

export const DINING_AREAS = ["AC_ROOM", "GARDEN"];
export const DINING_AREA_LABEL = { AC_ROOM: N_("AC Room"), GARDEN: N_("Garden") };
