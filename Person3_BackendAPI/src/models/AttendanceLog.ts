import { Schema, model } from 'mongoose';
import { CHECK_TYPES, ATTENDANCE_STATUSES } from '../constants';

/**
 * Item 9 (Flawless/Ultra blueprint): `gps_location` is an AES-256-GCM
 * envelope (see src/crypto/fieldEnvelope.ts), not a typed GeoJSON point, at
 * rest — sealed at write time and opened only for display
 * (attendanceService.ts, superAdminService.ts). `Mixed` + `select: false`,
 * matching FaceEmbedding.ts's `envelope` field exactly: opaque ciphertext
 * that Mongoose must never validate the shape of, and excluded from every
 * query by default so a future read path can't leak raw
 * {v,kv,alg,iv,ct,tag} material just by forgetting to call the decrypt
 * helper — it has to opt in with `.select('+gps_location')` AND still call
 * openGeoPoint() to get a usable value. Every current read call site that
 * needs it (attendanceService.ts, superAdminService.ts) already does both.
 *
 * TRADEOFF, documented rather than hidden: this field's `2dsphere` index
 * (previously below) is gone, and cannot come back without a different
 * design — an encrypted blob cannot be geospatially indexed. Verified safe
 * before this change: no code path anywhere in this codebase runs
 * `$geoWithin`/`$near` against *stored* AttendanceLog coordinates — the only
 * `$geoWithin`/`$centerSphere` queries (geofenceService.ts) run against the
 * separate `Geofence.location` field, using the live, in-flight check-in
 * coordinates before they are ever persisted here, not this field. A future
 * "historical check-ins near X" admin feature would need a deliberately
 * different design (e.g. a separate, unencrypted coarse-grained location
 * index) — not something this change should invent unasked.
 */
const attendanceLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    geofence_id: { type: Schema.Types.ObjectId, ref: 'Geofence', required: true },
    check_type: { type: String, enum: CHECK_TYPES, required: true },
    /** Device-reported time. */
    timestamp: { type: Date, required: true },
    /** Server receipt time — distinct from `timestamp` per the architecture report §3/§7. */
    server_timestamp: { type: Date, required: true, default: () => new Date() },
    gps_location: { type: Schema.Types.Mixed, required: true, select: false },
    /** FR-05. Fail-closed at the route layer: a missing/null client flag is treated as true. */
    mock_location_detected: { type: Boolean, required: true, default: false },
    liveness_passed: { type: Boolean, required: true, default: false },
    face_match_score: { type: Number, min: 0, max: 100, default: 0 },
    /**
     * Item 3b (Flawless/Ultra blueprint) — Person 4's passive moire/edge-
     * sharpness PAD heuristic, recorded for later threshold tuning the same
     * way face_match_score already is. Real but uncertified; never gates the
     * decision on its own (see attendanceService.ts's performCheckin).
     */
    passive_pad_confidence: { type: Number, min: 0, max: 100, default: null },
    selfie_url: { type: String, default: null },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  },
  { collection: 'attendance_logs' },
);

// Personal history queries (mobile) and admin range queries respectively.
attendanceLogSchema.index({ user_id: 1, timestamp: -1 });
attendanceLogSchema.index({ timestamp: -1 });
// No 2dsphere index on gps_location any more — see the field's own doc
// comment above for why removing it is safe and what it forecloses.

export const AttendanceLog = model('AttendanceLog', attendanceLogSchema);
