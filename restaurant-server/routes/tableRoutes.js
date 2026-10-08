import express from "express";
import {
  getTables, getTakeawayQR, createTable, updateTable, deleteTable, regenerateQR, validateTableToken,
} from "../controllers/tableController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireManagement } from "../middleware/rbac.js";

const router = express.Router();

const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.get("/", autoAuth, getTables);
router.get("/takeaway-qr", protect, requireManagement, getTakeawayQR);

// Public — lets a scanned QR be verified before the customer even logs in.
router.get("/:tableNo/validate", dbFromHeader, validateTableToken);

// Table management is structural (creates/removes physical tables) — admin only.
router.post("/",                       protect, requireManagement, createTable);
router.put("/:tableNo",                protect, requireManagement, updateTable);
router.delete("/:tableNo",             protect, requireManagement, deleteTable);
router.post("/:tableNo/regenerate-qr", protect, requireManagement, regenerateQR);

export default router;
