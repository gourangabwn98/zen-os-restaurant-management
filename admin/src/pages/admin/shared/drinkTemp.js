// src/pages/admin/shared/drinkTemp.js
// ─────────────────────────────────────────────────────────────────────────────
// Hot / Cold for the Beverages section of the order screens (OrderMenuPicker).
// Menu items have no hot/cold field, so it is read from the drink's
// subcategory and name. Cold words are checked first ("Cold Coffee",
// "Iced Tea" are cold). A drink matching neither stays under "All" only.
// Display filter only — nothing is saved or sent to the server.
// ─────────────────────────────────────────────────────────────────────────────

/** MenuItem.category of the drinks section (restaurant-server/utils/menuSections.js). */
export const BEVERAGES_SECTION = "Beverages";

const COLD = /\b(cold|iced?|chilled|frozen|frappe|shakes?|milk ?shakes?|thick ?shakes?|lassi|juices?|mocktails?|mojito|smoothies?|soda|cooler|lemonade|lime|nimbu|float|sharbat|sherbet|buttermilk|chaas|chhach|soft ?drinks?|cola|coke|pepsi|sprite|fanta|thums ?up|limca|mirinda|7 ?up|red ?bull|water|ice ?cream|falooda)\b/i;
const HOT = /\b(hot|tea|chai|cha|coffee|espresso|cappuccino|latte|americano|mocha|macchiato|kahwa|kadha|masala ?milk|haldi|bournvita|horlicks|hot ?chocolate)\b/i;

/** "Hot" | "Cold" | null for one menu item. */
export const drinkTemp = (m) => {
  const text = `${m?.subcategory || ""} ${m?.name || ""}`;
  if (COLD.test(text)) return "Cold";
  if (HOT.test(text)) return "Hot";
  return null;
};
