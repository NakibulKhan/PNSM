/**
 * Development/testing stand-in ONLY. This does not perform real biometric
 * verification of any kind — it produces a plausible, varying score so the
 * rest of the system (ADR-5's approve/flag branch, Socket.IO emission, the
 * admin flagged-queue) can be built and tested before Person 4's real
 * service exists. Never point this at a production deployment and treat its
 * output as a real identity check (ADR-8).
 */
import type { FaceEmbeddingResult, FaceVerificationService } from './FaceVerificationService';

export class MockFaceVerificationService implements FaceVerificationService {
  async generateEmbedding(photoUrl: string): Promise<FaceEmbeddingResult> {
    // Deterministic pseudo-vector so tests are reproducible — not a real embedding.
    const seed = hashString(photoUrl);
    const vector_data = Array.from({ length: 8 }, (_, i) => Math.sin(seed + i));
    return { vector_data, model_version: 'mock-v0' };
  }

  async scoreMatch(_selfieBuffer: Buffer, _embedding: FaceEmbeddingResult): Promise<number> {
    // Plausible variance around a generally-passing score, not a constant —
    // a constant would make the approve/flag branch untestable.
    const base = 88;
    const jitter = (Math.random() - 0.5) * 20; // +/-10
    const score = Math.max(0, Math.min(100, Math.round(base + jitter)));
    return score;
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 100_000;
  }
  return hash;
}
