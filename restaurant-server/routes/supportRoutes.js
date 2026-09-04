import express from "express";
import { createTicket, getMyTickets } from "../controllers/supportController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", optionalProtect, createTicket);
router.get("/my", protect, getMyTickets);

export default router;
