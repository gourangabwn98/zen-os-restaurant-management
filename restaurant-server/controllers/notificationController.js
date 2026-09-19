// controllers/notificationController.js
import {
  subscribeToken, unsubscribeToken, sendOfferBroadcast,
  listNotificationHistory, countSubscribedCustomers,
} from "../services/notificationService.js";
import { buildActor } from "../services/orderService.js";

// ── POST /api/notifications/subscribe ─────────────────────────────────────────
export const subscribe = async (req, res) => {
  try {
    await subscribeToken({ models: req.models, userId: req.user._id, token: req.body.token });
    res.json({ message: "Subscribed to offer notifications" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/notifications/unsubscribe ───────────────────────────────────────
export const unsubscribe = async (req, res) => {
  try {
    await unsubscribeToken({ models: req.models, userId: req.user._id, token: req.body.token });
    res.json({ message: "Unsubscribed from offer notifications" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── POST /api/notifications/admin/send ────────────────────────────────────────
export const sendBroadcast = async (req, res) => {
  try {
    const actor = buildActor(req.user);
    const log = await sendOfferBroadcast({
      models: req.models, title: req.body.title, body: req.body.body, actor,
    });
    res.json({ message: "Notification sent", log });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

// ── GET /api/notifications/admin/history ──────────────────────────────────────
export const getHistory = async (req, res) => {
  try {
    const [history, subscriberCount] = await Promise.all([
      listNotificationHistory({ models: req.models }),
      countSubscribedCustomers({ models: req.models }),
    ]);
    res.json({ history, subscriberCount });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
