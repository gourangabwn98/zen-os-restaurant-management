// src/i18n/bn/index.js — merges the Bengali dictionaries (one per admin area).
// Keys are the exact English strings passed to t(); see i18n/core.js.
import common from "./common.js";
import login from "./login.js";
import dashboard from "./dashboard.js";
import orders from "./orders.js";
import tables from "./tables.js";
import menu from "./menu.js";
import inventory from "./inventory.js";
import insights from "./insights.js";
import staff from "./staff.js";
import customers from "./customers.js";
import marketing from "./marketing.js";
import settings from "./settings.js";
import kitchen from "./kitchen.js";
import khoai from "./khoai.js";

export default {
  ...common, ...login, ...dashboard, ...orders, ...tables, ...menu, ...inventory,
  ...insights, ...staff, ...customers, ...marketing, ...settings, ...kitchen, ...khoai,
};
