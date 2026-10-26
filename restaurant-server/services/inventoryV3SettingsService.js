import { V3_STORAGE_VERSION, AUTO_ORDER_MODES } from "../config/inventoryV3Models.js";

export const V3_DEFAULTS = Object.freeze({ enabled: false, foodCostTargetBps: 3500, countIntervalDays: 4, autoOrderMode: "OFF", revision: 0 });
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const serverEnabled = () => process.env.INVENTORY_V3_ENABLED === "true";
export const settingsView = (record) => ({
  enabled: record?.enabled === true,
  foodCostTargetBps: record?.foodCostTargetBps ?? V3_DEFAULTS.foodCostTargetBps,
  countIntervalDays: record?.countIntervalDays ?? V3_DEFAULTS.countIntervalDays,
  autoOrderMode: record?.autoOrderMode ?? V3_DEFAULTS.autoOrderMode,
  revision: record?.revision ?? 0,
  storageReady: record?.storageVersion === V3_STORAGE_VERSION,
});
export const capabilitiesView = ({ record = null, backendEnabled = false, role }) => {
  const ready = record?.storageVersion === V3_STORAGE_VERSION;
  const enabled = backendEnabled && ready && record?.enabled === true;
  return {
    version: 3, phase: "P5", enabled,
    storageReady: ready,
    features: { stock: enabled, suppliers: enabled, purchases: enabled, financialEntries: enabled && role === "admin", counts: enabled, recipes: enabled, overview: enabled },
    permissions: { manageSettings: role === "admin", viewFinancials: role === "admin" },
  };
};
export const validateSettingsPatch = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("Settings must be an object");
  const allowed = new Set(["enabled", "foodCostTargetBps", "countIntervalDays", "autoOrderMode", "revision"]);
  if (Object.keys(body).some((k) => !allowed.has(k))) throw fail("Unknown settings field");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw fail("Current revision is required");
  const patch = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw fail("enabled must be a boolean");
    patch.enabled = body.enabled;
  }
  for (const [key, max] of [["foodCostTargetBps", 10000], ["countIntervalDays", 365]]) {
    if (body[key] === undefined) continue;
    if (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > max) throw fail(`${key} must be an integer from 1 to ${max}`);
    patch[key] = body[key];
  }
  if (body.autoOrderMode !== undefined) {
    if (!AUTO_ORDER_MODES.includes(body.autoOrderMode)) throw fail("Unknown auto-order mode");
    patch.autoOrderMode = body.autoOrderMode;
  }
  if (!Object.keys(patch).length) throw fail("No settings changes supplied");
  return patch;
};
export const updateV3Settings = async ({ Settings, body, actor, backendEnabled }) => {
  const patch = validateSettingsPatch(body);
  if (patch.enabled && !backendEnabled) throw fail("The backend V3 switch is off", 409);
  const record = await Settings.findOneAndUpdate(
    { _id: "default", storageVersion: V3_STORAGE_VERSION, revision: body.revision },
    { $set: { ...patch, updatedBy: actor }, $inc: { revision: 1 } },
    { returnDocument: "after", runValidators: true },
  );
  if (!record) throw fail("V3 storage is not ready or settings changed. Refresh before saving.", 409);
  return settingsView(record);
};
