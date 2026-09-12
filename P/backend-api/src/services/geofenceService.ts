/**
 * Authoritative geofence validation (FR-04).
 *
 * The blueprint is explicit that point-to-point Haversine math in application
 * code is the legacy approach and does not scale — the work is offloaded to
 * MongoDB's execution engine via a 2dsphere index. Both clients run their own
 * local distance pre-check for instant UI feedback; neither is trusted here.
 * This module is the only place a real geofence decision is made.
 */
import { Types } from 'mongoose';
import { Geofence } from '../models';
import { metersToRadians, looksFlippedForBangladesh, isValidLatLng, type LatLng } from '../utils/geo';

export interface GeofenceCheckResult {
  inside: boolean;
  geofence_id: string | null;
  /** Metres from the geofence centre, when it could be computed. Analytics/UI only. */
  distance_meters: number | null;
}

export class InvalidCoordinatesError extends Error {
  constructor(public reason: 'out_of_range' | 'looks_flipped') {
    super(reason);
    this.name = 'InvalidCoordinatesError';
  }
}

/**
 * Rejects malformed coordinates before they ever reach a query. Person 2 asked
 * explicitly that the backend reject reversed payloads the same way their
 * client does — a flipped pair never throws on its own, it just silently
 * relocates the office into the Indian Ocean and fails every check-in for
 * reasons that look unrelated.
 */
export function assertUsableCoordinates(point: LatLng): void {
  if (!isValidLatLng(point)) {
    throw new InvalidCoordinatesError('out_of_range');
  }
  // The incoming pair is named {lat, lng}, so we test the GeoJSON ordering it
  // would produce: [lng, lat]. If THAT looks like a Bangladesh [lat, lng]
  // pair, the client almost certainly swapped them before sending.
  if (looksFlippedForBangladesh([point.lng, point.lat])) {
    throw new InvalidCoordinatesError('looks_flipped');
  }
}

/**
 * Is this device position inside the given geofence? Uses $geoWithin with
 * $centerSphere over the 2dsphere index, with the radius converted to radians
 * (see metersToRadians — passing metres directly matches the whole planet).
 */
export async function isInsideGeofence(
  geofenceId: string | Types.ObjectId,
  point: LatLng,
): Promise<GeofenceCheckResult> {
  assertUsableCoordinates(point);

  const geofence = await Geofence.findById(geofenceId).lean();
  if (!geofence) {
    return { inside: false, geofence_id: null, distance_meters: null };
  }

  const radiusInRadians = metersToRadians(geofence.radius_meters);

  const match = await Geofence.findOne({
    _id: geofence._id,
    location: {
      $geoWithin: {
        $centerSphere: [[point.lng, point.lat], radiusInRadians],
      },
    },
  })
    .select('_id')
    .lean();

  return {
    inside: Boolean(match),
    geofence_id: String(geofence._id),
    distance_meters: await distanceToGeofenceCenter(point, geofence._id),
  };
}

/**
 * Exact metres from the device to a geofence centre, via the $geoNear
 * aggregation stage's distanceField. The blueprint calls this out for
 * analytics — "how far was the employee when they were rejected" is the single
 * most useful number on a failed check-in, both for HR review and for the
 * employee's own retry message.
 *
 * $geoNear must be the first stage in an aggregation pipeline, and requires a
 * 2dsphere index on the queried field — both satisfied here.
 */
export async function distanceToGeofenceCenter(
  point: LatLng,
  geofenceId: Types.ObjectId | string,
): Promise<number | null> {
  const results = await Geofence.aggregate<{ distance_meters: number }>([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [point.lng, point.lat] },
        distanceField: 'distance_meters',
        spherical: true,
        query: { _id: new Types.ObjectId(String(geofenceId)) },
      },
    },
    { $limit: 1 },
    { $project: { _id: 0, distance_meters: 1 } },
  ]);

  return results.length > 0 ? Math.round(results[0].distance_meters) : null;
}

/**
 * Finds any geofence belonging to an office that contains this point. Used
 * when a check-in doesn't name a specific geofence — an office may have more
 * than one zone (e.g. building + car park), per the proposal's
 * Offices→Geofences one-to-many cardinality.
 */
export async function findContainingGeofenceForOffice(
  officeId: string | Types.ObjectId,
  point: LatLng,
): Promise<GeofenceCheckResult> {
  assertUsableCoordinates(point);

  const zones = await Geofence.find({ office_id: officeId }).lean();

  for (const zone of zones) {
    const match = await Geofence.findOne({
      _id: zone._id,
      location: {
        $geoWithin: { $centerSphere: [[point.lng, point.lat], metersToRadians(zone.radius_meters)] },
      },
    })
      .select('_id')
      .lean();

    if (match) {
      return {
        inside: true,
        geofence_id: String(zone._id),
        distance_meters: await distanceToGeofenceCenter(point, zone._id),
      };
    }
  }

  return { inside: false, geofence_id: null, distance_meters: null };
}
