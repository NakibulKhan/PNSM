import { Schema, model } from 'mongoose';
import { deriveWeekLabel } from '../utils/shiftDays';

/**
 * ADR-3: `days_of_week` (0=Sun..6=Sat) is the source of truth.
 * `days_of_week_label` is regenerated on every save and must never be
 * hand-edited or parsed back into integers — see deriveWeekLabel().
 */
const shiftSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    start_time: { type: String, required: true }, // "HH:mm"
    end_time: { type: String, required: true }, // "HH:mm"
    days_of_week: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.every((d) => d >= 0 && d <= 6),
        message: 'days_of_week entries must be 0 (Sun) through 6 (Sat)',
      },
    },
    days_of_week_label: { type: String, default: '' },
  },
  { collection: 'shifts' },
);

interface ShiftPreSaveContext {
  days_of_week: number[];
  days_of_week_label: string;
}

shiftSchema.pre('save', function preSave(this: ShiftPreSaveContext, next: () => void) {
  this.days_of_week_label = deriveWeekLabel(this.days_of_week);
  next();
});

export const Shift = model('Shift', shiftSchema);
