// Shared lifecycle rules for the waiter UI. DELIVERED is the existing
// backend status used for Served; COMPLETED is only reached after the served
// order and its bill are both complete.
export const isServed = (order) => ["DELIVERED", "COMPLETED"].includes(order?.status);

// Payment collection and final bill actions are waiter-only UI actions and
// must not appear while the order is still in the kitchen workflow.
export const paymentActionsVisible = (order) => isServed(order);
