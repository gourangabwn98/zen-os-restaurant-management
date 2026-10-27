const EARTH_RADIUS_METERS = 6371000;

const invalid = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });

const numberInRange = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export const parseCustomerLocation = (location) => {
  const latitude = numberInRange(location?.latitude, -90, 90);
  const longitude = numberInRange(location?.longitude, -180, 180);
  return latitude == null || longitude == null ? null : { latitude, longitude };
};

export const distanceMeters = (a, b) => {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
};

/** Customer-only DINE_IN gate. Staff callers must not use this helper. */
export const assertWithinDiningRadius = ({ profile, location }) => {
  const customer = parseCustomerLocation(location);
  if (!customer) throw invalid("A valid device location is required to place a dine-in order", 400, "LOCATION_REQUIRED");

  const restaurant = parseCustomerLocation({ latitude: profile?.latitude, longitude: profile?.longitude });
  const radius = Number(profile?.dineInRange);
  if (!restaurant || !Number.isFinite(radius) || radius < 0) {
    throw invalid("The restaurant's ordering area is not configured yet", 503, "LOCATION_CONFIG_UNAVAILABLE");
  }

  const distance = distanceMeters(customer, restaurant);
  if (distance > radius) {
    throw Object.assign(new Error("You are outside the restaurant's permitted ordering area"), {
      statusCode: 403, code: "OUTSIDE_DINING_RADIUS",
      details: { distanceMeters: Math.round(distance), radiusMeters: radius },
    });
  }
  return { distanceMeters: distance, radiusMeters: radius };
};
