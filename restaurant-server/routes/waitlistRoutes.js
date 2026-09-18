import express from "express";
import {
  getWaitlist, createWaitlistEntry, notifyWaitlistEntry,
  seatWaitlistEntryHandler, cancelWaitlistEntryHandler,
} from "../controllers/waitlistController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireStaff } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect, requireStaff);

router.get("/",              getWaitlist);
router.post("/",             createWaitlistEntry);
router.post("/:id/notify",   notifyWaitlistEntry);
router.post("/:id/seat",     seatWaitlistEntryHandler);
router.post("/:id/cancel",   cancelWaitlistEntryHandler);

export default router;
