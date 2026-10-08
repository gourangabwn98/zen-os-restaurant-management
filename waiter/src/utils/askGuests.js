// KH-11 — "How many guests are seated?" when a dine-in bill is printed.
// Returns the guest count (1..100), or null when the print should be
// cancelled. Pre-filled with the order's last count (reprint = same count,
// editable). The server only charges AC Room orders (guests × rate).
import { t } from "../i18n/index.jsx";

export const needsGuests = (orderType) => orderType === "DINE_IN";

export const askGuests = (current) => {
  for (;;) {
    const raw = window.prompt(t("How many guests are seated?"), current ? String(current) : "");
    if (raw === null) return null; // cancelled → don't print
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
    window.alert(t("Please enter a number of guests from 1 to 100"));
  }
};
