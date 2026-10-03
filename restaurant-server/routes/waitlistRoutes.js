import express from "express";
import {
  getWaitlist, createWaitlistEntry, notifyWaitlistEntry,
  seatWaitlistEntryHandler, cancelWaitlistEntryHandler,
} from "../controllers/waitlistController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect, requireStaff);

router.get("/",              getWaitlist);
router.post("/",             createWaitlistEntry);
router.post("/:id/notify",   notifyWaitlistEntry);
router.post("/:id/seat",     seatWaitlistEntryHandler);
router.post("/:id/cancel",   cancelWaitlistEntryHandler);

export default router;
