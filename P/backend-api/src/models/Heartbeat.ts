import { Schema, model } from 'mongoose';

/**
 * Background telemetry heartbeat (blueprint Quadrant I; DECISIONS.md B7).
 * "Device alive and here" — NEVER an attendance event, never read by the
 * attendance pipeline. At a 15s interval this is by far the highest-volume
 * write in the system, so it gets a TTL index rather than unbounded growth:
 * a heartbeat is only useful for a live "last seen" read, not permanent
 * history, so documents expire on their own 24h after `received_at`.
 */
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  { _id: false },
);

const heartbeatSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    location: { type: geoPointSchema, required: true },
    accuracy_meters: { type: Number, default: null },
    /** Device-reported capture time. */
    timestamp: { type: Date, required: true },
    /** Server receipt time — same distinction as AttendanceLog.server_timestamp. */
    received_at: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'heartbeats' },
);

heartbeatSchema.index({ user_id: 1, received_at: -1 });
// TTL: MongoDB deletes a document once `received_at` is this many seconds in
// the past. 86400s = 24h — comfortably longer than any single shift, short
// enough that this collection never grows unbounded.
heartbeatSchema.index({ received_at: 1 }, { expireAfterSeconds: 86400 });

export const Heartbeat = model('Heartbeat', heartbeatSchema);
