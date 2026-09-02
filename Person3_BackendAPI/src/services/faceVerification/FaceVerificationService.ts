/**
 * ADR-8: Person 4's real embedding/scoring service isn't available yet.
 * Everything else in the attendance pipeline is written against this
 * interface, so swapping the mock adapter for a real HTTP/gRPC client later
 * touches exactly one file (src/services/faceVerification/index.ts) and
 * nothing else — not the routes, not the ADR-5 threshold logic, not the
 * Socket.IO emission.
 */
export interface FaceEmbeddingResult {
  vector_data: number[] | string;
  model_version: string;
}

export interface FaceVerificationService {
  /** Called from POST /employees and PATCH /employees/:id/photo once a reference_photo_url exists. */
  generateEmbedding(photoUrl: string): Promise<FaceEmbeddingResult>;

  /** Called from the check-in pipeline after PIN/geofence/mock-location/liveness all pass. Returns 0-100. */
  scoreMatch(selfieBuffer: Buffer, embedding: FaceEmbeddingResult): Promise<number>;
}
