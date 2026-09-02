import { Schema, model } from 'mongoose';
import { CHECK_TYPES, ATTENDANCE_STATUSES } from '../constants';

const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  { _id: false },
);

const attendanceLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    geofence_id: { type: Schema.Types.ObjectId, ref: 'Geofence', required: true },
    check_type: { type: String, enum: CHECK_TYPES, required: true },
    /** Device-reported time. */
    timestamp: { type: Date, required: true },
    /** Server receipt time — distinct from `timestamp` per the architecture report §3/§7. */
    server_timestamp: { type: Date, required: true, default: () => new Date() },
    gps_location: { type: geoPointSchema, required: true },
    /** FR-05. Fail-closed at the route layer: a missing/null client flag is treated as true. */
    mock_location_detected: { type: Boolean, required: true, default: false },
    liveness_passed: { type: Boolean, required: true, default: false },
    face_match_score: { type: Number, min: 0, max: 100, default: 0 },
    selfie_url: { type: String, default: null },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  },
  { collection: 'attendance_logs' },
);

// Personal history queries (mobile) and admin range queries respectively.
attendanceLogSchema.index({ user_id: 1, timestamp: -1 });
attendanceLogSchema.index({ timestamp: -1 });
attendanceLogSchema.index({ gps_location: '2dsphere' });

export const AttendanceLog = model('AttendanceLog', attendanceLogSchema);
