import { FACE_SERVICE_PROVIDER } from '../../config/env';
import type { FaceVerificationService } from './FaceVerificationService';
import { MockFaceVerificationService } from './MockFaceVerificationService';

let instance: FaceVerificationService | null = null;

/**
 * Only 'mock' is implemented today. When Person 4's real service exists,
 * add a case here (e.g. 'person4-http') returning a new adapter class that
 * implements the same interface — no other file in the codebase changes.
 */
export function getFaceVerificationService(): FaceVerificationService {
  if (instance) return instance;
  switch (FACE_SERVICE_PROVIDER) {
    case 'mock':
    default:
      instance = new MockFaceVerificationService();
      return instance;
  }
}

export type { FaceVerificationService, FaceEmbeddingResult } from './FaceVerificationService';
