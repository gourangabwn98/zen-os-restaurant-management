// controllers/couponController.js — thin HTTP wrapper over services/couponService.js
import {
  listLiveCoupons, getLiveCoupon, listAllCoupons, createCoupon, updateCoupon, deleteCoupon,
} from "../services/couponService.js";
import { buildActor } from "../services/orderService.js";

const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

// ── GET /api/coupons — coupons a customer can use right now ─────────────────
export const getLiveCoupons = async (req, res) => {
  try { res.json(await listLiveCoupons({ models: req.models })); } catch (err) { fail(res, err); }
};

// ── GET /api/coupons/check/:code — validate a typed-in code ──────────────────
export const checkCoupon = async (req, res) => {
  try { res.json({ coupon: await getLiveCoupon({ models: req.models, code: req.params.code }) }); } catch (err) { fail(res, err); }
};

// ── Admin ────────────────────────────────────────────────────────────────────
export const getAllCoupons = async (req, res) => {
  try { res.json({ coupons: await listAllCoupons({ models: req.models }), serverNow: new Date() }); } catch (err) { fail(res, err); }
};

export const addCoupon = async (req, res) => {
  try {
    const coupon = await createCoupon({ models: req.models, body: req.body, actor: buildActor(req.user) });
    res.status(201).json({ message: "Coupon created", coupon });
  } catch (err) { fail(res, err); }
};

export const editCoupon = async (req, res) => {
  try {
    const coupon = await updateCoupon({ models: req.models, id: req.params.id, body: req.body });
    res.json({ message: "Coupon updated", coupon });
  } catch (err) { fail(res, err); }
};

export const removeCoupon = async (req, res) => {
  try {
    await deleteCoupon({ models: req.models, id: req.params.id });
    res.json({ message: "Coupon deleted" });
  } catch (err) { fail(res, err); }
};
