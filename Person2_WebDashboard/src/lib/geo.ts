/**
 * Coordinate transport layer.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT
 * -----------------------------------
 * MongoDB and GeoJSON store points as [longitude, latitude]. Human-facing
 * conventions, most REST payloads and several mapping libraries put latitude
 * first. They are the same two numbers in the opposite order, so a flip NEVER
 * throws — it silently relocates a Dhaka office into the Indian Ocean, and every
 * check-in then fails geofence validation for reasons that look like a backend
 * fault.
 *
 * WHERE THE RISK ACTUALLY SITS IN THIS APPLICATION
 * MapLibre GL (like Mapbox GL) uses `LngLat` — longitude first, the SAME order
 * as GeoJSON. That is a real advantage over Leaflet, which is latitude-first and
 * historically the main source of this bug: at the map boundary there is now
 * nothing to convert, and `src/components/map/*` passes GeoJSON tuples straight
 * through.
 *
 * The risk therefore concentrates at two remaining boundaries:
 *   1. anything that reads or writes a coordinate as a NAMED lat/lng pair
 *      (form fields, the API's flat write payload, human-readable display), and
 *   2. anything arriving from Person 1's mobile client or Person 3's API.
 * Cross either boundary ONLY through the functions below.
 */
import { z } from 'zod';
import type { GeoJSONPoint } from '@/types/models';

/** Latitude-first tuple. Used by human-facing conventions and Leaflet-style APIs. */
export type LatLngTuple = [number, number];
/** Longitude-first tuple. GeoJSON, MongoDB and MapLibre `LngLat` all use this. */
export type LngLatTuple = [number, number];

/** Bangladesh bounding box, used as a sanity guard rather than a hard limit. */
export const BD_BOUNDS = {
  minLat: 20.5,
  maxLat: 26.7,
  minLng: 88.0,
  maxLng: 92.7,
} as const;

/** GeoJSON [lng, lat] -> latitude-first [lat, lng]. */
export function toLatLngTuple(point: LngLatTuple): LatLngTuple {
  return [point[1], point[0]];
}

/** Named lat/lng -> GeoJSON [lng, lat]. The canonical write conversion. */
export function toGeoJSONTuple(lat: number, lng: number): LngLatTuple {
  return [lng, lat];
}

/** Build a complete GeoJSON Point from Leaflet-order numbers. */
export function toGeoJSONPoint(lat: number, lng: number): GeoJSONPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

/** Read a GeoJSON Point into a latitude-first tuple. */
export function pointToLatLngTuple(point: GeoJSONPoint): LatLngTuple {
  return [point.coordinates[1], point.coordinates[0]];
}

/** Read a GeoJSON Point into named fields — the safest way to display values. */
export function pointToLatLng(point: GeoJSONPoint): { lat: number; lng: number } {
  return { lat: point.coordinates[1], lng: point.coordinates[0] };
}

/** Absolute validity. Anything outside this is malformed, not merely unusual. */
export const latitudeSchema = z
  .number({ invalid_type_error: 'Latitude must be a number' })
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const longitudeSchema = z
  .number({ invalid_type_error: 'Longitude must be a number' })
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const latLngSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});

/**
 * GeoJSON Point schema with a flip detector.
 *
 * If coordinates arrive as [lat, lng] for a Bangladesh location, the first
 * value lands in 20.5-26.7 and the second in 88-92.7 — a pattern that cannot
 * occur in correct [lng, lat] data for this country. We reject it loudly.
 *
 * The flip check runs BEFORE the plain range checks, deliberately, via
 * `superRefine` rather than `.tuple([longitudeSchema, latitudeSchema]).refine()`:
 * a real Dhaka longitude (~90.4) exceeds latitude's ±90 range, so a flipped
 * [lat, lng] pair for this country always trips the range check on its own —
 * `.refine()` never runs once the base tuple has already failed, so the
 * specific, actionable "this looks reversed" message never surfaced for
 * exactly the coordinate pairs it exists to catch. First real `npm test` run
 * for this project (never executed before) caught this via the regression
 * suite's own assertion on `issues[0]`.
 */
export const geoJSONPointSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z.tuple([
      z.number({ invalid_type_error: 'Longitude must be a number' }),
      z.number({ invalid_type_error: 'Latitude must be a number' }),
    ]),
  })
  .superRefine((point, ctx) => {
    const [lng, lat] = point.coordinates;
    if (looksFlippedForBangladesh(point.coordinates)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinates'],
        message:
          'Coordinates look reversed. GeoJSON requires [longitude, latitude]; this looks like [latitude, longitude].',
      });
      return; // A second, less specific range issue would only bury the useful one.
    }
    if (lng < -180 || lng > 180) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinates', 0],
        message: 'Longitude must be between -180 and 180',
      });
    }
    if (lat < -90 || lat > 90) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinates', 1],
        message: 'Latitude must be between -90 and 90',
      });
    }
  });

/** True when a [lng, lat] tuple looks like it was actually written [lat, lng]. */
export function looksFlippedForBangladesh(coordinates: LngLatTuple): boolean {
  const [first, second] = coordinates;
  const firstLooksLikeBdLat = first >= BD_BOUNDS.minLat && first <= BD_BOUNDS.maxLat;
  const secondLooksLikeBdLng = second >= BD_BOUNDS.minLng && second <= BD_BOUNDS.maxLng;
  return firstLooksLikeBdLat && secondLooksLikeBdLng;
}

/** Advisory check for the geofence editor — warn, do not block. */
export function isWithinBangladesh(lat: number, lng: number): boolean {
  return (
    lat >= BD_BOUNDS.minLat &&
    lat <= BD_BOUNDS.maxLat &&
    lng >= BD_BOUNDS.minLng &&
    lng <= BD_BOUNDS.maxLng
  );
}

/** Great-circle distance in metres. Mirrors the backend's spatial validation. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Display form for a coordinate, fixed to 6 decimals (~11 cm precision). */
export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

/** "23.780600 N, 90.407400 E" — unambiguous for humans reading the UI. */
export function formatLatLng(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${formatCoordinate(Math.abs(lat))} ${ns}, ${formatCoordinate(Math.abs(lng))} ${ew}`;
}
