import { z } from 'zod';

/**
 * Matches Person 2's documented POST /geofences body (01-API-CONTRACT.md):
 * flat named { lat, lng }, never a raw GeoJSON pair on the wire — converted
 * via utils/geo.ts on the way in.
 */
export const createGeofenceSchema = z.object({
  office_name: z.string().trim().min(1),
  address: z.string().trim().default(''),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_meters: z.number().positive(),
});
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;

export const updateGeofenceSchema = z
  .object({
    office_name: z.string().trim().min(1),
    address: z.string().trim(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_meters: z.number().positive(),
  })
  .partial();
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;
