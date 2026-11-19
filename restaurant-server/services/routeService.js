// services/routeService.js — driving route + ETA for a rider's active stops,
// via the Google Routes API (computeRoutes). The key is a SERVER secret
// (GOOGLE_ROUTES_API_KEY in .env), never shipped in an app.
//
// Stop logic (never blindly re-sequenced):
//   • every job not picked up yet needs the restaurant first (pickup dependency)
//     — the restaurant is one stop for all of them;
//   • drops are then ordered by Google's waypoint optimisation, starting from
//     the rider's position; the app shows it as a SUGGESTION, the rider decides.
// No key / API error → { available: false, reason } — the app then shows
// straight-line distances and no ETA. Nothing is ever estimated by us.
import axios from "axios";
import { ACTIVE_JOB_STATUSES } from "../utils/deliveryStateMachine.js";

const URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const ll = (p) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
const okPoint = (p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));

export const routesConfigured = () => !!process.env.GOOGLE_ROUTES_API_KEY;

export const planRiderRoute = async ({ models, user, origin, http = axios }) => {
  const state = await models.DeliveryPartnerState.findOne({ partner: user._id }).select("lastLocation").lean();
  const from = okPoint(origin) ? { latitude: Number(origin.latitude), longitude: Number(origin.longitude) } : state?.lastLocation;
  if (!okPoint(from)) throw fail("Your current location isn't known yet", 409);
  const jobs = await models.DeliveryJob.find({ partner: user._id, status: { $in: ACTIVE_JOB_STATUSES } }).sort({ assignedAt: 1 }).lean();
  if (!jobs.length) return { available: true, stops: [] };

  const needPickup = jobs.filter((j) => ["ASSIGNED", "AT_RESTAURANT"].includes(j.status));
  const stops = [];
  if (needPickup.length && okPoint(needPickup[0].pickup)) {
    stops.push({ kind: "PICKUP", jobIds: needPickup.map((j) => String(j._id)), point: needPickup[0].pickup, label: needPickup[0].pickup.name || "Restaurant" });
  }
  const drops = jobs.filter((j) => okPoint(j.drop)).map((j) => ({ kind: "DROP", jobIds: [String(j._id)], orderNo: j.orderNo, point: j.drop, label: j.orderNo }));

  if (!routesConfigured()) return { available: false, reason: "ROUTES_NOT_CONFIGURED", stops: [...stops, ...drops] };

  // The pickup (if any) is the fixed first stop; drops are optimised after it.
  const destination = drops.length ? drops[drops.length - 1] : stops[0];
  const intermediates = [...stops, ...drops.slice(0, -1)];
  const body = {
    origin: ll(from), destination: ll(destination.point),
    intermediates: intermediates.map((s) => ll(s.point)),
    travelMode: "TWO_WHEELER", routingPreference: "TRAFFIC_AWARE",
    // Only optimise when the pickup isn't among the intermediates (it must stay first).
    optimizeWaypointOrder: !stops.length && intermediates.length > 1,
  };
  try {
    const { data } = await http.post(URL, body, {
      timeout: 8000,
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters,routes.optimizedIntermediateWaypointIndex",
      },
    });
    const route = data?.routes?.[0];
    if (!route) return { available: false, reason: "NO_ROUTE", stops: [...stops, ...drops] };
    const order = route.optimizedIntermediateWaypointIndex?.length ? route.optimizedIntermediateWaypointIndex : intermediates.map((_, i) => i);
    const sequence = [...order.map((i) => intermediates[i]), destination];
    const secs = (d) => (d ? Number(String(d).replace("s", "")) : null);
    return {
      available: true,
      stops: sequence.map((s, i) => ({ ...s, legDurationSec: secs(route.legs?.[i]?.duration), legDistanceM: route.legs?.[i]?.distanceMeters ?? null })),
      totalDurationSec: secs(route.duration), totalDistanceM: route.distanceMeters ?? null,
      polyline: route.polyline?.encodedPolyline || null,
    };
  } catch (err) {
    console.error("routes API failed:", err.response?.status, err.message);
    return { available: false, reason: "ROUTES_API_ERROR", stops: [...stops, ...drops] };
  }
};
