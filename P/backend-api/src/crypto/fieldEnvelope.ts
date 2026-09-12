/**
 * AES-256-GCM field encryption (Item 9, Flawless/Ultra blueprint) — the local
 * equivalent of MongoDB Queryable Encryption, per the user's explicit choice
 * (no new native dependency, same confidentiality goal). Mirrors
 * Person4_AIBiometricService/app/crypto/fle.py's envelope shape and
 * reasoning exactly: AES-256-GCM, AAD-bound to the owning record so a
 * ciphertext copied onto a different document fails the tag check instead of
 * silently decrypting, versioned so a future algorithm change stays
 * backward-readable. `model_version` from fle.py's envelope is dropped here
 * — not applicable outside the face-embedding use case.
 *
 * Node's built-in `crypto` module — no new dependency, unlike a real
 * MongoDB Queryable Encryption integration (`mongodb-client-encryption`
 * needs a native libmongocrypt build, with known Windows build friction).
 */
import crypto from 'node:crypto';

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'AES-256-GCM';
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;
const SECRET_LEN = 32;

export interface FieldEnvelope {
  v: number;
  kv: string;
  alg: 'AES-256-GCM';
  iv: string;
  ct: string;
  tag: string;
  created_at: string;
}

export class GeoKeyProvider {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;

  constructor(keysJson: string, activeKeyId: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(keysJson);
    } catch (err) {
      throw new Error('PNSM_GEO_FLE_KEYS must be JSON, e.g. {"k1":"<base64 32 bytes>"}', { cause: err });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('PNSM_GEO_FLE_KEYS must be a JSON object');
    }
    const entries = Object.entries(parsed as Record<string, unknown>).map(([keyId, raw]) => {
      if (typeof raw !== 'string') throw new Error(`PNSM_GEO_FLE_KEYS[${keyId}] must be a base64 string`);
      const key = Buffer.from(raw, 'base64');
      if (key.length !== SECRET_LEN) {
        throw new Error(`PNSM_GEO_FLE_KEYS[${keyId}] must decode to ${SECRET_LEN} bytes, got ${key.length}`);
      }
      return [keyId, key] as const;
    });
    if (entries.length === 0) throw new Error('PNSM_GEO_FLE_KEYS must be a non-empty JSON object');
    this.keys = new Map(entries);
    if (!this.keys.has(activeKeyId)) {
      throw new Error(
        `PNSM_GEO_FLE_ACTIVE_KEY=${activeKeyId} is not present in PNSM_GEO_FLE_KEYS (available: ${[...this.keys.keys()].sort().join(', ')})`,
      );
    }
    this.activeKeyId = activeKeyId;
  }

  activeKey(): { keyId: string; key: Buffer } {
    return { keyId: this.activeKeyId, key: this.keys.get(this.activeKeyId)! };
  }

  keyFor(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`unknown PNSM_GEO_FLE key id ${keyId}`);
    return key;
  }
}

/** AES-GCM additional authenticated data. Order and separator are format — matches fle.py's build_aad(). */
function buildAad(userRef: string, field: string, keyId: string): Buffer {
  return Buffer.from(`${userRef}|${field}|${keyId}`, 'utf8');
}

/**
 * Encrypts any JSON-serialisable value into a storable envelope.
 * `field` binds the ciphertext to which document field it came from, the
 * same role `model_version` plays in fle.py's AAD — swapping an
 * envelope between fields (or employees, via `userRef`) fails the GCM tag
 * check on open rather than silently decrypting into the wrong place.
 */
export function seal<T>(plaintext: T, opts: { userRef: string; field: string; provider: GeoKeyProvider }): FieldEnvelope {
  const { keyId, key } = opts.provider.activeKey();
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const aad = buildAad(opts.userRef, opts.field, keyId);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const plaintextBuf = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: ENVELOPE_VERSION,
    kv: keyId,
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
    created_at: new Date().toISOString(),
  };
}

export class EnvelopeDecryptError extends Error {}

/**
 * Decrypts an envelope back into its original value.
 * Throws EnvelopeDecryptError on tampering, a wrong/rotated-away key, or a
 * cross-field/cross-employee substitution (GCM tag check failure) — all
 * three are security events, not routine errors.
 */
export function open<T = unknown>(envelope: FieldEnvelope, opts: { userRef: string; field: string; provider: GeoKeyProvider }): T {
  if (envelope.alg !== ALGORITHM) {
    throw new EnvelopeDecryptError(`unsupported algorithm ${envelope.alg}`);
  }
  let key: Buffer;
  try {
    key = opts.provider.keyFor(envelope.kv);
  } catch (err) {
    throw new EnvelopeDecryptError(String(err instanceof Error ? err.message : err));
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== GCM_IV_LEN || tag.length !== GCM_TAG_LEN) {
    throw new EnvelopeDecryptError('malformed envelope: unexpected iv/tag length');
  }
  const aad = buildAad(opts.userRef, opts.field, envelope.kv);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    const plaintextBuf = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plaintextBuf.toString('utf8')) as T;
  } catch (err) {
    // Wrong key, tampered ciphertext, or a swapped userRef/field — GCM's
    // tag check failed. Never leak which of the three it was.
    throw new EnvelopeDecryptError('GCM tag verification failed (tampering, wrong key, or wrong field/userRef)');
  }
}
