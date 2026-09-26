import { useEffect, useState } from "react";
import { getRestaurantProfile } from "../services/restaurantService.js";

let last = null;

/** Public restaurant profile (name, banners, phonePeEnabled, UPI, contact).
 * Returns the last-seen value immediately and refetches on every mount, so
 * an admin's change still shows up on the next screen the customer opens. */
export function useRestaurantProfile() {
  const [profile, setProfile] = useState(last);
  useEffect(() => {
    let alive = true;
    getRestaurantProfile()
      .then(({ data }) => { last = data?.data || null; if (alive) setProfile(last); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return profile;
}
