import { Schema, model } from 'mongoose';

const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  { _id: false },
);

const spoofAlertSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    detected_at: { type: Date, required: true, default: () => new Date() },
    reason: { type: String, required: true },
    gps_location: { type: geoPointSchema, required: true },
  },
  { collection: 'spoof_alerts' },
);

spoofAlertSchema.index({ detected_at: -1 });

export const SpoofAlert = model('SpoofAlert', spoofAlertSchema);
