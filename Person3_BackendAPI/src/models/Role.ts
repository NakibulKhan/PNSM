import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLE_NAMES } from '../constants';

const roleSchema = new Schema(
  {
    role_name: { type: String, enum: ROLE_NAMES, required: true, unique: true },
    permissions: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'roles' },
);

export type RoleDocument = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);
