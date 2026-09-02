import { Geofence, Office } from '../models';
import type { CreateGeofenceInput, UpdateGeofenceInput } from '../validation/geofenceSchemas';
import { toGeoJSONPoint, pointToLatLng } from '../utils/geo';
import { assertUsableCoordinates } from './geofenceService';
import { AdminApiError } from '../utils/errors';

function toOfficeDTO(office: { _id: unknown; office_name: string; address: string }) {
  return { _id: String(office._id), office_name: office.office_name, address: office.address };
}

function toGeofenceDTO(geofence: {
  _id: unknown;
  office_id: { _id?: unknown; office_name?: string } | unknown;
  // Mongoose infers a plain array for a `[Number]`-typed schema field, not a
  // fixed 2-tuple — the schema's own validator enforces length 2 at runtime.
  location: { type: 'Point'; coordinates: number[] };
  radius_meters: number;
}) {
  const office = geofence.office_id as { _id?: unknown; office_name?: string } | null;
  return {
    _id: String(geofence._id),
    office_id: office?._id ? String(office._id) : String(geofence.office_id),
    location: geofence.location,
    radius_meters: geofence.radius_meters,
    office_name: office?.office_name,
  };
}

export async function listOffices() {
  const offices = await Office.find({}).sort({ office_name: 1 }).lean();
  return offices.map(toOfficeDTO);
}

export async function listGeofences() {
  const geofences = await Geofence.find({}).populate('office_id', 'office_name').sort({ _id: -1 }).lean();
  return geofences.map(toGeofenceDTO);
}

/** POST /geofences creates the Office AND the Geofence in one call, per 01-API-CONTRACT.md. */
export async function createGeofence(input: CreateGeofenceInput) {
  assertUsableCoordinates({ lat: input.lat, lng: input.lng });
  const office = await Office.create({ office_name: input.office_name, address: input.address });
  const geofence = await Geofence.create({
    office_id: office._id,
    location: toGeoJSONPoint({ lat: input.lat, lng: input.lng }),
    radius_meters: input.radius_meters,
  });
  return toGeofenceDTO({ ...geofence.toObject(), office_id: office.toObject() });
}

export async function updateGeofence(id: string, input: UpdateGeofenceInput) {
  const existing = await Geofence.findById(id);
  if (!existing) throw new AdminApiError(404, 'NOT_FOUND', 'Geofence not found.');

  if (input.office_name !== undefined || input.address !== undefined) {
    await Office.findByIdAndUpdate(existing.office_id, {
      ...(input.office_name !== undefined ? { office_name: input.office_name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    });
  }

  const update: Record<string, unknown> = {};
  if (input.radius_meters !== undefined) update.radius_meters = input.radius_meters;
  if (input.lat !== undefined && input.lng !== undefined) {
    assertUsableCoordinates({ lat: input.lat, lng: input.lng });
    update.location = toGeoJSONPoint({ lat: input.lat, lng: input.lng });
  } else if (input.lat !== undefined || input.lng !== undefined) {
    throw new AdminApiError(422, 'VALIDATION_FAILED', 'lat and lng must be updated together.');
  }

  const updated = await Geofence.findByIdAndUpdate(id, update, { new: true })
    .populate('office_id', 'office_name')
    .lean();
  return toGeofenceDTO(updated!);
}

export async function deleteGeofence(id: string): Promise<void> {
  const deleted = await Geofence.findByIdAndDelete(id);
  if (!deleted) throw new AdminApiError(404, 'NOT_FOUND', 'Geofence not found.');
}

/** Used by mobile's GET /me to hand back a named {lat,lng} pair, never raw GeoJSON. */
export function geofenceToNamedPoint(geofence: { location: { coordinates: number[] } }) {
  return pointToLatLng(geofence.location as { type: 'Point'; coordinates: [number, number] });
}
