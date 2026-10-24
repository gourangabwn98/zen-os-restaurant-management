import { getInventoryV3Models } from "../config/inventoryV3Models.js";
import { effectiveRole } from "../middleware/rbac.js";
import { serverEnabled, settingsView, capabilitiesView, updateV3Settings } from "../services/inventoryV3SettingsService.js";

const settingsModel = (req) => getInventoryV3Models(req.db).InventoryV3Settings;
export const getCapabilities = async (req, res) => {
  res.set("Cache-Control", "no-store");
  const backendEnabled = serverEnabled();
  try {
    // Default OFF performs no V3 collection query or registration.
    const record = backendEnabled ? await settingsModel(req).findById("default").lean() : null;
    res.json(capabilitiesView({ record, backendEnabled, role: effectiveRole(req.user) }));
  } catch {
    res.status(503).json({ enabled: false, message: "Inventory V3 availability could not be checked" });
  }
};
export const getSettings = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const record = await settingsModel(req).findById("default").lean();
    res.json({ settings: settingsView(record), backendEnabled: serverEnabled() });
  } catch {
    res.status(503).json({ message: "Inventory V3 settings are unavailable" });
  }
};
export const patchSettings = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const settings = await updateV3Settings({ Settings: settingsModel(req), body: req.body,
      actor: { user: req.user._id, name: req.user.name || "", role: effectiveRole(req.user) }, backendEnabled: serverEnabled() });
    res.json({ settings });
  } catch (err) {
    res.status(err.statusCode || 503).json({ message: err.statusCode ? err.message : "Inventory V3 settings could not be saved" });
  }
};
