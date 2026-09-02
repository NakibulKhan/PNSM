import { Schema, model } from 'mongoose';

/**
 * `location` is always GeoJSON [longitude, latitude] (locked rule #1).
 * Cross the lat/lng <-> GeoJSON boundary only through src/utils/geo.ts —
 * never construct this coordinates tuple by hand elsewhere.
 */
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      validate: {
        validator: (v: number[]) => Array.isArray(v) && v.length === 2,
        message: 'coordinates must be a [longitude, latitude] pair',
      },
    },
  },
  { _id: false },
);

const geofenceSchema = new Schema(
  {
    office_id: { type: Schema.Types.ObjectId, ref: 'Office', required: true },
    location: { type: geoPointSchema, required: true },
    radius_meters: { type: Number, required: true, min: 1 },
  },
  { collection: 'geofences' },
);

// Locked rule #3: native MongoDB 2dsphere index for all geospatial queries.
geofenceSchema.index({ location: '2dsphere' });

export const Geofence = model('Geofence', geofenceSchema);
