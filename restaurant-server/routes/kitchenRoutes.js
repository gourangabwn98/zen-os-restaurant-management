import express from "express";
import { getKitchenOrders, updateKitchenOrderStatus } from "../controllers/kitchenController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireKitchen } from "../middleware/rbac.js";
import { objectIdParam } from "../middleware/validateIds.js";

const router = express.Router();
// Malformed ids → 404, never a CastError 500 (middleware/validateIds.js).
router.param("id", objectIdParam);
router.use(protect, requireKitchen);

router.get("/orders",              getKitchenOrders);
router.patch("/orders/:id/status", updateKitchenOrderStatus);

export default router;
