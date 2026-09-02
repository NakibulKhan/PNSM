import { Schema, model } from 'mongoose';

/**
 * Biometric embeddings, DECOUPLED from the Users document.
 *
 * The blueprint names the embedded-on-User design a "recognized
 * vulnerability" that "severely violates modern data-protection compliance
 * architectures" — mingling PII (name, email, employee code) with biometric
 * telemetry in one document means any read of a user profile also reads their
 * faceprint. The v2 proposal already tracked this as its top production
 * upgrade (§2.7). This collection implements that separation.
 *
 * `vector_data` is stored as an opaque ciphertext string, never a raw float
 * array. Encryption/decryption happens in the seam at
 * src/services/faceVerification/embeddingCrypto.ts — Person 4 owns the actual
 * AES-256-GCM implementation and the KMS key material, per Quadrant IV.
 *
 * `select: false` on the vector means it is excluded from every query unless a
 * caller explicitly opts in, so it cannot leak into an API response by
 * accident.
 */
const faceEmbeddingSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    /** Ciphertext. Never plaintext floats — see embeddingCrypto.ts. */
    vector_data: { type: String, required: true, select: false },
    /** Which cipher/key produced vector_data, so keys can be rotated later. */
    encryption: {
      algorithm: { type: String, default: 'none' },
      key_id: { type: String, default: null },
    },
    model_version: { type: String, required: true },
  },
  { collection: 'face_embeddings', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

export const FaceEmbedding = model('FaceEmbedding', faceEmbeddingSchema);
