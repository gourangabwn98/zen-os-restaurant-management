// src/pages/admin/shared/statusLabels.js — ONE set of order-status words for
// every admin screen (DSH-04 floor vocabulary). Keys are the canonical enum
// (restaurant-server/utils/orderStateMachine.js); values are English keys,
// translated where they render.
import { N_ } from "../../../i18n/core.js";

export const ORDER_STATUS_LABEL = {
  AWAITING_PAYMENT: N_("Awaiting payment"),
  PENDING_CONFIRMATION: N_("Pending confirmation"),
  CONFIRMED: N_("Placed"),
  PREPARING: N_("Cooking"),
  READY: N_("Ready to Deliver"),
  DELIVERED: N_("Served"),
  COMPLETED: N_("Completed"),
  CANCELLED: N_("Cancelled"),
};
