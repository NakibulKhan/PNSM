/**
 * Geodesic circle geometry for geofence rendering.
 *
 * WHY THIS IS NOT A CSS CIRCLE
 * ----------------------------
 * A geofence is a fixed distance on the ground. Drawing it as a fixed-pixel
 * circle would be wrong at every zoom level except one, and would mislead an
 * HR user setting a 50 m indoor perimeter. The radius must be expressed in
 * metres and projected, so the shape grows and shrinks correctly as the map
 * zooms and distorts appropriately with latitude.
 *
 * The polygon produced here is the visual twin of the server-side check. Person
 * 3 validates a check-in with MongoDB's `$centerSphere`, which takes its radius
 * in RADIANS — metres divided by the Earth's equatorial radius, 6,378,137 m.
 * `metersToRadians` below is that exact conversion, so the circle an
 * administrator drags on screen is the same boundary the database enforces.
 */
import type { LngLatTuple } from './geo';

/** WGS-84 equatorial radius in metres — the value MongoDB assumes. */
export const EARTH_RADIUS_METERS = 6_378_137;

/** The conversion Person 3 performs for `$centerSphere`. Mirrored for parity. */
export function metersToRadians(meters: number): number {
  return meters / EARTH_RADIUS_METERS;
}

export function radiansToMeters(radians: number): number {
  return radians * EARTH_RADIUS_METERS;
}

/**
 * Build a GeoJSON Polygon approximating a circle of `radiusMeters` around a
 * centre, in GeoJSON [longitude, latitude] order.
 *
 * `steps` controls smoothness. 64 is imperceptibly polygonal at city zoom and
 * cheap enough to regenerate on every frame while the radius slider is dragged.
 */
export function circlePolygon(
  center: LngLatTuple,
  radiusMeters: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = center;
  const coordinates: [number, number][] = [];

  // Metres per degree: latitude is near-constant; longitude contracts with cos(lat).
  const latRadians = (lat * Math.PI) / 180;
  const metersPerDegreeLat = 111_132.92 - 559.82 * Math.cos(2 * latRadians);
  const metersPerDegreeLng = 111_412.84 * Math.cos(latRadians) - 93.5 * Math.cos(3 * latRadians);

  const deltaLat = radiusMeters / metersPerDegreeLat;
  const deltaLng = radiusMeters / Math.max(metersPerDegreeLng, 1);

  for (let i = 0; i < steps; i += 1) {
    const theta = (i / steps) * 2 * Math.PI;
    coordinates.push([lng + deltaLng * Math.cos(theta), lat + deltaLat * Math.sin(theta)]);
  }
  coordinates.push(coordinates[0]); // GeoJSON rings must close.

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

/**
 * Zoom level at which a circle of `radiusMeters` fills roughly `fraction` of a
 * viewport `pixels` wide. Used to frame a geofence sensibly when it is selected.
 */
export function zoomForRadius(
  lat: number,
  radiusMeters: number,
  pixels = 640,
  fraction = 0.6,
): number {
  const targetMetersAcross = (radiusMeters * 2) / fraction;
  const metersPerPixelAtZoom0 = (156_543.03392 * Math.cos((lat * Math.PI) / 180));
  const zoom = Math.log2((metersPerPixelAtZoom0 * pixels) / targetMetersAcross);
  return Math.min(19, Math.max(3, zoom));
}
