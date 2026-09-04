import express from "express";
import { getKitchenOrders, updateKitchenOrderStatus } from "../controllers/kitchenController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireKitchen } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect, requireKitchen);

router.get("/orders",              getKitchenOrders);
router.patch("/orders/:id/status", updateKitchenOrderStatus);

export default router;
