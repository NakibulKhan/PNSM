/**
 * Coordinate transport layer.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT (see architecture report §6 / Person 2's
 * own geo.ts and Bug Bible #5): MongoDB/GeoJSON stores points as
 * [longitude, latitude]. A flip never throws — it silently relocates a Dhaka
 * office into the Indian Ocean and every geofence check then fails for
 * reasons that look like an unrelated bug. Named { lat, lng } fields on the
 * wire avoid ordering mistakes entirely; this module is the only place that
 * crosses between that named form and GeoJSON.
 *
 * The backend is authoritative here — client-side pre-checks (both Person 1's
 * and Person 2's) are for instant UX feedback only, per the report.
 */
import { BD_BOUNDS } from '../constants';
import type { GeoJSONPoint } from '../types/models';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Absolute validity — anything outside this is malformed, not merely unusual (mirrors Person 2's own latitudeSchema/longitudeSchema bounds). */
export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function isValidLatLng(value: LatLng): boolean {
  return isValidLatitude(value.lat) && isValidLongitude(value.lng);
}

export function toGeoJSONPoint({ lat, lng }: LatLng): GeoJSONPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

export function pointToLatLng(point: GeoJSONPoint): LatLng {
  return { lat: point.coordinates[1], lng: point.coordinates[0] };
}

/**
 * True when a [lng, lat] tuple looks like it was actually written [lat, lng].
 * For Bangladesh, a reversed tuple lands its first value in 20.5-26.7 and its
 * second in 88-92.7 — a pattern impossible in correctly-ordered data for this
 * country. Mirrors Person 2's looksFlippedForBangladesh() exactly so both
 * sides reject the same bad input the same way.
 */
export function looksFlippedForBangladesh(coordinates: [number, number]): boolean {
  const [first, second] = coordinates;
  const firstLooksLikeBdLat = first >= BD_BOUNDS.minLat && first <= BD_BOUNDS.maxLat;
  const secondLooksLikeBdLng = second >= BD_BOUNDS.minLng && second <= BD_BOUNDS.maxLng;
  return firstLooksLikeBdLat && secondLooksLikeBdLng;
}

export function isWithinBangladesh({ lat, lng }: LatLng): boolean {
  return (
    lat >= BD_BOUNDS.minLat &&
    lat <= BD_BOUNDS.maxLat &&
    lng >= BD_BOUNDS.minLng &&
    lng <= BD_BOUNDS.maxLng
  );
}

/**
 * Earth's EQUATORIAL radius, per WGS-84. This specific value is required for
 * the $centerSphere radian conversion — MongoDB's own documentation and the
 * PNSM blueprint both specify 6,378,137 m. Using the mean radius (6,371,000)
 * here silently shrinks every geofence by ~0.11%, i.e. about 11 cm on a 100 m
 * radius. Small, but it's a boundary condition on an attendance decision, so
 * it should be exactly right rather than approximately right.
 */
export const EARTH_EQUATORIAL_RADIUS_METERS = 6_378_137;

/**
 * Earth's MEAN radius. Correct for Haversine great-circle distance, which
 * models the Earth as a sphere — deliberately a different constant from the
 * equatorial radius above. Do not "unify" these two; they are different
 * numbers for different reasons.
 */
export const EARTH_MEAN_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance in metres. Only used where Mongo's native
 * $geoWithin/$centerSphere isn't already doing the work — the geospatial
 * query is the authoritative check for a real geofence decision (report §6);
 * this is available for cases that need a plain number (e.g. a UI-facing
 * "how far were they" figure on a rejected check-in).
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = EARTH_MEAN_RADIUS_METERS;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Radians helper for constructing a $centerSphere query. MongoDB processes
 * spherical geometry in radians, not metres, so an HR-defined radius must be
 * divided by the Earth's equatorial radius before it reaches the query.
 * Forgetting this conversion is the classic $centerSphere bug: passing metres
 * directly produces a radius of ~100 radians, which matches the entire planet
 * and makes every geofence check trivially pass.
 */
export function metersToRadians(meters: number): number {
  return meters / EARTH_EQUATORIAL_RADIUS_METERS;
}
