/**
 * Client-side geofence pre-check.
 *
 * SCOPE NOTE: the blueprint (Quadrant III) explicitly moves authoritative
 * geofence validation OFF the client and into MongoDB's $geoWithin /
 * $centerSphere execution engine, precisely to avoid running Haversine in
 * application code at scale. That is correct and this file does not compete
 * with it.
 *
 * What remains legitimately client-side is instant UX feedback: the employee
 * needs the "INSIDE / OUT OF RANGE" badge to update live as they walk toward
 * the building, which cannot mean a network round-trip per GPS tick. One
 * Haversine evaluation per position update on a single device is trivial —
 * the computational-overhead concern in the blueprint is about the server
 * doing this across millions of documents, not one phone doing it for itself.
 *
 * The server's verdict always wins. If this pre-check and the backend ever
 * disagree, the backend is right and the UI shows the backend's rejection.
 */

const EARTH_RADIUS_M = 6378137.0; // WGS-84 equatorial radius (matches backend)

/**
 * Great-circle distance in metres between two WGS-84 points.
 * @returns {number} metres
 */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isInsideGeofence(lat, lng, office) {
  return distanceMeters(lat, lng, office.lat, office.lng) <= office.radiusMeters;
}

/**
 * Mirrors the backend's metres->radians conversion so both sides agree on the
 * same earth radius constant. Exported mainly so the value can be asserted in
 * tests against Person 3's documented formula.
 */
export function metersToRadians(meters) {
  return meters / EARTH_RADIUS_M;
}

/**
 * GeoJSON ordering is [longitude, latitude] — the reverse of the [lat, lng]
 * convention used almost everywhere else. Getting this backwards silently
 * places Dhaka in the Indian Ocean, so payload construction goes through this
 * helper rather than building the array inline.
 */
export function toGeoJsonPoint(lat, lng) {
  return { type: "Point", coordinates: [lng, lat] };
}

/**
 * The hardcoded office directory that used to live here (DECISIONS.md N4)
 * is gone — an employee's office/geofence now comes from the real backend
 * (GET /api/mobile/me), since check-in needs a real Mongo geofence_id that
 * no client-side constant could ever provide. Test fixtures for known
 * Dhaka coordinates live in each test file that needs them.
 */
