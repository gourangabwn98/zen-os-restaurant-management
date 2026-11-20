// local/staffLoginGate.js
// ─────────────────────────────────────────────────────────────────────────────
// Offline Edition: in LOCAL_PRIMARY mode, admin / manager / inventory /
// waiter / chef accounts sign in ONLY with phone + PIN on a registered
// device (routes/localAuthRoutes.js). The existing SMS-OTP / Firebase staff
// login routes would mint tokens that skip device registration, so they are
// refused here for those roles. CLOUD mode: these middlewares call next()
// immediately — the production login flow is untouched.
//
// Riders (role "delivery") and customers keep the existing flows in LOCAL
// mode (rider offline login is phase O8). Even if a PIN-role token were
// minted some other way, protect() refuses it (DEVICE_LOGIN_REQUIRED).
// ─────────────────────────────────────────────────────────────────────────────
import { isLocalPrimary } from "../config/deploymentMode.js";
import { getDB } from "../config/db.js";
import { getModels } from "../config/getModels.js";
import { PIN_LOGIN_ROLES } from "../config/localAuthModels.js";

const usePin = (res) => res.status(403).json({
  message: "On this restaurant's local server, staff sign in with their phone and PIN on a registered device.",
  code: "USE_PIN_LOGIN",
});

/** Admin login routes: always PIN in LOCAL mode. */
export const blockInLocalMode = (_req, res, next) => (isLocalPrimary() ? usePin(res) : next());

/** Shared employee routes: refuse only when the phone belongs to a PIN-login role. */
export const blockPinRolesInLocalMode = async (req, res, next) => {
  if (!isLocalPrimary()) return next();
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  if (!phone) return next(); // the controller answers its own validation error
  try {
    const { User } = getModels(await getDB(process.env.MONGO_URI));
    const pinRole = await User.exists({ phone, $or: [{ role: { $in: PIN_LOGIN_ROLES } }, { isAdmin: true }] });
    return pinRole ? usePin(res) : next();
  } catch {
    return res.status(503).json({ message: "Cannot connect to restaurant database" });
  }
};
