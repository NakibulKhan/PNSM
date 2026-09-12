import { Schema, model } from 'mongoose';

const billingComponentSchema = new Schema(
  { name: { type: String, required: true }, cost: { type: Number, required: true } },
  { _id: false },
);

const billingSchema = new Schema(
  {
    _singletonKey: { type: String, required: true, unique: true, default: 'singleton' },
    plan: { type: String, required: true, default: 'Starter' },
    seats: { type: Number, required: true, default: 0 },
    monthly_cost_bdt: { type: Number, required: true, default: 0 },
    renewal_date: { type: Date, required: true, default: () => new Date() },
    components: { type: [billingComponentSchema], default: [] },
  },
  { collection: 'billing' },
);

export const Billing = model('Billing', billingSchema);

/** Same atomic-upsert reasoning as getSingletonPolicy() — see that function's comment. */
export async function getSingletonBilling() {
  return Billing.findOneAndUpdate(
    { _singletonKey: 'singleton' },
    { $setOnInsert: { _singletonKey: 'singleton' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
