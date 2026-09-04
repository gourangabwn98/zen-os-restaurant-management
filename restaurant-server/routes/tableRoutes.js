import express from "express";
import {
  getTables, createTable, updateTable, deleteTable, regenerateQR, validateTableToken,
} from "../controllers/tableController.js";
import { protect, dbFromHeader } from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/rbac.js";

const router = express.Router();

const autoAuth = (req, res, next) =>
  req.headers.authorization?.startsWith("Bearer ")
    ? protect(req, res, next)
    : dbFromHeader(req, res, next);

router.get("/", autoAuth, getTables);

// Public — lets a scanned QR be verified before the customer even logs in.
router.get("/:tableNo/validate", dbFromHeader, validateTableToken);

// Table management is structural (creates/removes physical tables) — admin only.
router.post("/",                       protect, requireAdmin, createTable);
router.put("/:tableNo",                protect, requireAdmin, updateTable);
router.delete("/:tableNo",             protect, requireAdmin, deleteTable);
router.post("/:tableNo/regenerate-qr", protect, requireAdmin, regenerateQR);

export default router;
