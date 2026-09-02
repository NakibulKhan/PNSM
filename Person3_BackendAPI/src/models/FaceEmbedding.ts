import { Schema, model } from 'mongoose';

/**
 * Biometric embeddings, DECOUPLED from the Users document.
 *
 * The blueprint names the embedded-on-User design a "recognized
 * vulnerability" — mingling PII with biometric telemetry means any read of a
 * user profile also reads their faceprint. This collection implements that
 * separation.
 *
 * `envelope` is Person 4's AES-256-GCM/KMS-sealed output from `POST /v1/embed`
 * (`{ v, kp, kv, dek, alg, iv, ct, tag, model_version, created_at }`), stored
 * OPAQUE and VERBATIM per Person 4's explicit instruction in
 * Person4_AIBiometricService/docs/API.md: "do not reformat it, and do not
 * attempt to read it — the key never leaves this service... do not validate
 * the shape yourself, because it will change again." Schema.Types.Mixed,
 * not a fixed sub-schema, for exactly that reason.
 *
 * This supersedes the original `vector_data`(ciphertext string)/`encryption`
 * design from Phase 1 (DECISIONS.md N1/N8) — that shape assumed Person 3
 * would own the encrypt/decrypt seam (`services/faceVerification/
 * embeddingCrypto.ts`); the real, shipped Person 4 service does not work that
 * way; it hands back one opaque envelope object and keeps the key entirely on
 * its side.
 *
 * `select: false` on the envelope means it is excluded from every query
 * unless a caller explicitly opts in, so it cannot leak into an API response
 * by accident even though it is already unreadable without Person 4's key.
 */
const faceEmbeddingSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    /** Opaque. Store verbatim, parse nothing. See services/aiClient. */
    envelope: { type: Schema.Types.Mixed, required: true, select: false },
    /**
     * Mirrors envelope.model_version at the top level (harmless duplication)
     * so a MODEL_VERSION_MISMATCH-adjacent query/audit doesn't need to select
     * and inspect the opaque envelope.
     */
    model_version: { type: String, required: true },
  },
  { collection: 'face_embeddings', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

export const FaceEmbedding = model('FaceEmbedding', faceEmbeddingSchema);
