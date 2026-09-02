import { Schema, model, Types } from 'mongoose';

/**
 * Locked rule #6: password_hash, pin_hash, and biometric embeddings are
 * never exposed to any client. `select: false` means these fields are
 * excluded from every query by default — a handler has to opt in with
 * `.select('+password_hash')` explicitly, which makes "did we mean to
 * expose this" a visible, greppable decision rather than an accident.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true, select: false },
    /** 4-digit 2FA PIN hash. Set by Admin/HR at onboarding — see architecture report §4. */
    pin_hash: { type: String, select: false },
    role_id: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    phone: { type: String, default: '' },
    employee_code: { type: String, unique: true, sparse: true, trim: true },
    department: { type: String, default: '' },
    office_id: { type: Schema.Types.ObjectId, ref: 'Office', default: null },
    is_active: { type: Boolean, default: true },
    reference_photo_url: { type: String, default: null },
    // face_embedding is deliberately ABSENT. Biometric vectors live in the
    // separate, encrypted `face_embeddings` collection (see
    // models/FaceEmbedding.ts) so a profile read never touches biometric data.
  },
  { collection: 'users', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

export interface UserDocumentLean {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password_hash?: string;
  pin_hash?: string;
  role_id: Types.ObjectId;
  phone: string;
  employee_code?: string;
  department?: string;
  office_id?: Types.ObjectId | null;
  is_active: boolean;
  reference_photo_url: string | null;
  created_at: Date;
}

export const User = model('User', userSchema);
