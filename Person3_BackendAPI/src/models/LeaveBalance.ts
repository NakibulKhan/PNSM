import { Schema, model } from 'mongoose';
import { LEAVE_TYPES } from '../constants';

const leaveBalanceSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leave_type: { type: String, enum: LEAVE_TYPES, required: true },
    total: { type: Number, required: true, min: 0 },
    used: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'leave_balances' },
);

leaveBalanceSchema.index({ user_id: 1, leave_type: 1 }, { unique: true });

export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema);
