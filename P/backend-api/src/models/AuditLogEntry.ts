import { Schema, model } from 'mongoose';

const auditLogEntrySchema = new Schema(
  {
    actor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    target: { type: String, required: true },
  },
  { collection: 'audit_log_entries', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

auditLogEntrySchema.index({ created_at: -1 });

export const AuditLogEntry = model('AuditLogEntry', auditLogEntrySchema);
