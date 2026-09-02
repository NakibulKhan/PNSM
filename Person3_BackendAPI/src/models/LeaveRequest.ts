import { Schema, model } from 'mongoose';
import { LEAVE_TYPES, LEAVE_STATUSES } from '../constants';

/**
 * ADR-2: adds `leave_type`, absent from Person 2's original model. Field
 * translation to/from mobile's `type`/`from`/`to`/`id` naming happens only
 * at the mobile route boundary — this schema keeps the canonical
 * `leave_type`/`from_date`/`to_date`/`_id` names Person 2's frontend already
 * expects.
 */
const leaveRequestSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leave_type: { type: String, enum: LEAVE_TYPES, required: true },
    from_date: { type: Date, required: true },
    to_date: { type: Date, required: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: LEAVE_STATUSES, required: true, default: 'pending' },
  },
  { collection: 'leave_requests', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

leaveRequestSchema.index({ user_id: 1, status: 1 });

export const LeaveRequest = model('LeaveRequest', leaveRequestSchema);
