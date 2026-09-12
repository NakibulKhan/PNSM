import { Schema, model } from 'mongoose';

const notificationSchema = new Schema(
  {
    recipient_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    log_id: { type: Schema.Types.ObjectId, ref: 'AttendanceLog', default: null },
    message: { type: String, required: true },
    is_read: { type: Boolean, default: false },
  },
  { collection: 'notifications', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

notificationSchema.index({ recipient_id: 1, is_read: 1 });

export const Notification = model('Notification', notificationSchema);
