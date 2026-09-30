// controllers/couponController.js — thin HTTP wrapper over services/couponService.js
// (+ couponOfferService.js for the admin actions that also manage the push).
import { listLiveCoupons, getLiveCoupon, listAllCoupons } from "../services/couponService.js";
import {
  createCouponWithNotice, updateCouponWithNotice, deleteCouponWithNotice,
} from "../services/couponOfferService.js";
import { buildActor } from "../services/orderService.js";

const fail = (res, err) => res.status(err.statusCode || 500).json({ message: err.message });

// Any logged-in account counts as "registered" for a coupon's audience —
// staff never order through the customer cart, and staff orders take no coupon.
const isRegistered = (req) => Boolean(req.user);

// ── GET /api/coupons — coupons this customer can use right now ──────────────
export const getLiveCoupons = async (req, res) => {
  try { res.json(await listLiveCoupons({ models: req.models, isRegistered: isRegistered(req) })); } catch (err) { fail(res, err); }
};

// ── GET /api/coupons/check/:code — validate a typed-in code ──────────────────
export const checkCoupon = async (req, res) => {
  try {
    res.json({ coupon: await getLiveCoupon({ models: req.models, code: req.params.code, isRegistered: isRegistered(req) }) });
  } catch (err) { fail(res, err); }
};

// ── Admin ────────────────────────────────────────────────────────────────────
export const getAllCoupons = async (req, res) => {
  try { res.json({ coupons: await listAllCoupons({ models: req.models }), serverNow: new Date() }); } catch (err) { fail(res, err); }
};

export const addCoupon = async (req, res) => {
  try {
    const { coupon, warning } = await createCouponWithNotice({ models: req.models, body: req.body, actor: buildActor(req.user) });
    res.status(201).json({ message: "Coupon created", coupon, warning });
  } catch (err) { fail(res, err); }
};

export const editCoupon = async (req, res) => {
  try {
    const { coupon, warning } = await updateCouponWithNotice({
      models: req.models, id: req.params.id, body: req.body, actor: buildActor(req.user),
    });
    res.json({ message: "Coupon updated", coupon, warning });
  } catch (err) { fail(res, err); }
};

export const removeCoupon = async (req, res) => {
  try {
    await deleteCouponWithNotice({ models: req.models, id: req.params.id });
    res.json({ message: "Coupon deleted" });
  } catch (err) { fail(res, err); }
};
