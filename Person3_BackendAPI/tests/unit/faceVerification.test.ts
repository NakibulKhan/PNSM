import { MockFaceVerificationService } from '@/services/faceVerification/MockFaceVerificationService';
import { getFaceVerificationService } from '@/services/faceVerification';

describe('MockFaceVerificationService (ADR-8 — dev/test stand-in only)', () => {
  const service = new MockFaceVerificationService();

  it('generateEmbedding returns a vector and a model_version tag', async () => {
    const result = await service.generateEmbedding('https://example.com/photo.jpg');
    expect(Array.isArray(result.vector_data)).toBe(true);
    expect((result.vector_data as number[]).length).toBeGreaterThan(0);
    // Clearly tagged as a mock, never something that could be confused with
    // a real Person 4 model version string.
    expect(result.model_version).toBe('mock-v0');
  });

  it('generateEmbedding is deterministic for the same input (reproducible tests)', async () => {
    const a = await service.generateEmbedding('https://example.com/same-photo.jpg');
    const b = await service.generateEmbedding('https://example.com/same-photo.jpg');
    expect(a.vector_data).toEqual(b.vector_data);
  });

  it('scoreMatch always returns a value within the valid 0-100 range', async () => {
    const embedding = await service.generateEmbedding('https://example.com/photo.jpg');
    for (let i = 0; i < 30; i += 1) {
      const score = await service.scoreMatch(Buffer.from('fake-selfie-bytes'), embedding);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('scoreMatch produces varying scores, not a constant (so approve/flag branching is testable)', async () => {
    const embedding = await service.generateEmbedding('https://example.com/photo.jpg');
    const scores = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      scores.add(await service.scoreMatch(Buffer.from('x'), embedding));
    }
    expect(scores.size).toBeGreaterThan(1);
  });
});

describe('getFaceVerificationService factory', () => {
  it('returns a MockFaceVerificationService by default (FACE_SERVICE_PROVIDER=mock in test env)', () => {
    const service = getFaceVerificationService();
    expect(service).toBeInstanceOf(MockFaceVerificationService);
  });

  it('returns the same singleton instance on repeated calls', () => {
    const a = getFaceVerificationService();
    const b = getFaceVerificationService();
    expect(a).toBe(b);
  });
});
