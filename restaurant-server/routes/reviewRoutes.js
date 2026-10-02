// routes/reviewRoutes.js — customer rating of a paid order (customer app).
// The logged-in customer who placed the order, or the guest holding its
// x-guest-order-token; ownership is checked in services/reviewService.js.
import express from "express";
import { optionalProtect } from "../middleware/authMiddleware.js";
import { getOrderReviewState, submitOrderReview } from "../services/reviewService.js";

const router = express.Router();
const send = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message }); }
};

router.get("/order/:orderId", optionalProtect, send(async (req, res) => {
  const { Order, StaffReview } = req.models;
  res.json(await getOrderReviewState({ Order, StaffReview, req, orderId: req.params.orderId }));
}));

router.post("/order/:orderId", optionalProtect, send(async (req, res) => {
  const { Order, StaffReview } = req.models;
  const { food, service, comment } = req.body || {};
  res.status(201).json(await submitOrderReview({ Order, StaffReview, req, orderId: req.params.orderId, food, service, comment }));
}));

export default router;
