import { Schema, model } from 'mongoose';

/** Item 9 (Flawless/Ultra blueprint) — AES-256-GCM envelope, same `Mixed` + `select: false` shape and reasoning as AttendanceLog.ts's gps_location. */
const spoofAlertSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    detected_at: { type: Date, required: true, default: () => new Date() },
    reason: { type: String, required: true },
    gps_location: { type: Schema.Types.Mixed, required: true, select: false },
  },
  { collection: 'spoof_alerts' },
);

spoofAlertSchema.index({ detected_at: -1 });

export const SpoofAlert = model('SpoofAlert', spoofAlertSchema);
