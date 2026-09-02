/**
 * Encryption seam for biometric embedding vectors (blueprint Quadrant IV).
 *
 * Person 4 owns the real AES-256-GCM implementation and the AWS KMS key
 * material. Person 3 owns this interface and the persistence path, so the
 * database schema and the check-in pipeline can be built and tested now
 * without blocking on KMS provisioning.
 *
 * The passthrough implementation below is NOT encryption. It exists so
 * development works before keys exist, and it labels itself honestly as
 * `algorithm: 'none'` in the stored document so no one can mistake an
 * unencrypted vector for an encrypted one. A deployment check should refuse
 * to start in production while this is still the active provider.
 */
export interface EmbeddingCipher {
  readonly algorithm: string;
  readonly keyId: string | null;
  encrypt(vector: number[]): Promise<string>;
  decrypt(ciphertext: string): Promise<number[]>;
}

/** Development-only. Serialises without protecting. Never use in production. */
export class PassthroughEmbeddingCipher implements EmbeddingCipher {
  readonly algorithm = 'none';
  readonly keyId = null;

  async encrypt(vector: number[]): Promise<string> {
    return JSON.stringify(vector);
  }

  async decrypt(ciphertext: string): Promise<number[]> {
    return JSON.parse(ciphertext) as number[];
  }
}

let cipher: EmbeddingCipher = new PassthroughEmbeddingCipher();

/** Person 4 calls this at boot once the KMS-backed cipher is available. */
export function setEmbeddingCipher(next: EmbeddingCipher): void {
  cipher = next;
}

export function getEmbeddingCipher(): EmbeddingCipher {
  return cipher;
}

export function isEmbeddingEncryptionActive(): boolean {
  return cipher.algorithm !== 'none';
}
