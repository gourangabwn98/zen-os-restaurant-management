import express from "express";
import { getAllOpenSessions, getTableSession, closeSession } from "../controllers/tableSessionController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";
import { requireWaiterOnDuty } from "../middleware/dutyMiddleware.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect, requireStaff);

router.get("/",               getAllOpenSessions);
router.get("/:tableNo",       getTableSession);
router.post("/:id/close",     requireWaiterOnDuty, closeSession);

export default router;
