import { Schema, model } from 'mongoose';

const officeSchema = new Schema(
  {
    office_name: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
  },
  { collection: 'offices' },
);

export const Office = model('Office', officeSchema);
