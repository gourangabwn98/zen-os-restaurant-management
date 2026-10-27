import assert from "node:assert/strict";
import { assertWithinDiningRadius, distanceMeters, parseCustomerLocation } from "../utils/diningRadius.js";

const profile = { latitude: 22.5726, longitude: 88.3639, dineInRange: 200 };
const at = (latitude, longitude) => ({ profile, location: { latitude, longitude } });

assert.deepEqual(parseCustomerLocation({ latitude: 22, longitude: 88 }), { latitude: 22, longitude: 88 });
assert.equal(parseCustomerLocation({ latitude: 91, longitude: 88 }), null);
assert.equal(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
assert.ok(assertWithinDiningRadius(at(profile.latitude, profile.longitude)).distanceMeters === 0);
const edgeLongitude = profile.longitude + (profile.dineInRange / (6371000 * Math.cos(profile.latitude * Math.PI / 180))) * 180 / Math.PI;
assert.ok(assertWithinDiningRadius(at(profile.latitude, edgeLongitude)).distanceMeters <= profile.dineInRange);
assert.throws(() => assertWithinDiningRadius(at(profile.latitude, profile.longitude + 0.01)), (err) => err.code === "OUTSIDE_DINING_RADIUS" && err.statusCode === 403);
assert.throws(() => assertWithinDiningRadius({ profile, location: null }), (err) => err.code === "LOCATION_REQUIRED" && err.statusCode === 400);
assert.throws(() => assertWithinDiningRadius({ profile: {}, location: { latitude: 22, longitude: 88 } }), (err) => err.code === "LOCATION_CONFIG_UNAVAILABLE" && err.statusCode === 503);

console.log("diningRadius.test.js: coordinate validation, boundary inclusion, outside, missing location and invalid configuration passed");
