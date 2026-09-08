import { seal, open, GeoKeyProvider, EnvelopeDecryptError } from '@/crypto/fieldEnvelope';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');

function provider(activeKeyId = 'k1') {
  return new GeoKeyProvider(JSON.stringify({ k1: KEY_A, k2: KEY_B }), activeKeyId);
}

describe('GeoKeyProvider', () => {
  it('rejects a key that does not decode to 32 bytes', () => {
    expect(() => new GeoKeyProvider(JSON.stringify({ k1: Buffer.alloc(16).toString('base64') }), 'k1')).toThrow(/32 bytes/);
  });

  it('rejects malformed JSON', () => {
    expect(() => new GeoKeyProvider('not json', 'k1')).toThrow(/JSON/);
  });

  it('rejects an active key id absent from the map', () => {
    expect(() => provider('missing')).toThrow(/not present/);
  });
});

describe('seal/open round-trip', () => {
  const point = { type: 'Point' as const, coordinates: [90.4257, 23.8151] as [number, number] };

  it('round-trips a value through seal then open', () => {
    const envelope = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    expect(envelope.alg).toBe('AES-256-GCM');
    expect(envelope.kv).toBe('k1');

    const opened = open<typeof point>(envelope, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    expect(opened).toEqual(point);
  });

  it('produces genuinely different ciphertext for the same plaintext on each call (random IV)', () => {
    const a = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    const b = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rejects a tampered ciphertext (GCM tag check fails)', () => {
    const envelope = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    const tampered = { ...envelope, ct: Buffer.from('tampered-bytes-here!').toString('base64') };
    expect(() => open(tampered, { userRef: 'user-1', field: 'gps_location', provider: provider() })).toThrow(
      EnvelopeDecryptError,
    );
  });

  it('rejects opening with the wrong userRef (AAD mismatch)', () => {
    const envelope = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    expect(() => open(envelope, { userRef: 'user-2', field: 'gps_location', provider: provider() })).toThrow(
      EnvelopeDecryptError,
    );
  });

  it('rejects opening with the wrong field (AAD mismatch)', () => {
    const envelope = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    expect(() => open(envelope, { userRef: 'user-1', field: 'other_field', provider: provider() })).toThrow(
      EnvelopeDecryptError,
    );
  });

  it('rejects an envelope referencing a key id no longer in the key map', () => {
    const envelope = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider() });
    const onlyK2 = new GeoKeyProvider(JSON.stringify({ k2: KEY_B }), 'k2');
    expect(() => open(envelope, { userRef: 'user-1', field: 'gps_location', provider: onlyK2 })).toThrow(
      EnvelopeDecryptError,
    );
  });

  it('key rotation: an envelope sealed under k1 still opens after the active key moves to k2', () => {
    const sealedUnderK1 = seal(point, { userRef: 'user-1', field: 'gps_location', provider: provider('k1') });
    const opened = open<typeof point>(sealedUnderK1, { userRef: 'user-1', field: 'gps_location', provider: provider('k2') });
    expect(opened).toEqual(point);
  });
});
