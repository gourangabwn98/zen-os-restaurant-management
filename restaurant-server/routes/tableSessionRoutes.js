import express from "express";
import { getAllOpenSessions, getTableSession, closeSession } from "../controllers/tableSessionController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect, requireStaff);

router.get("/",               getAllOpenSessions);
router.get("/:tableNo",       getTableSession);
router.post("/:id/close",     closeSession);

export default router;
