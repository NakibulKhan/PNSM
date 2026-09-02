import { uploadCheckinSelfie, SelfieTooLargeError, UnsupportedImageTypeError } from '@/services/storage/storageService';

/**
 * No storage credentials are set in the test env, so this exercises the
 * "unconfigured" path: no network call, no exception, and — critically — no
 * false claim that an upload succeeded. The real PutObject path needs live
 * credentials or an @aws-sdk mock and is deferred to the phase that wires
 * this into the check-in route.
 */
describe('uploadCheckinSelfie', () => {
  it('reports mode "unconfigured" rather than faking success', async () => {
    const result = await uploadCheckinSelfie(Buffer.from('fake-jpeg'), 'image/jpeg');
    expect(result.mode).toBe('unconfigured');
    expect(result.mode).not.toBe('uploaded');
  });

  it('keys selfies under the configured prefix', async () => {
    const result = await uploadCheckinSelfie(Buffer.from('x'), 'image/jpeg');
    expect(result.key.startsWith('checkins/')).toBe(true);
  });

  it('picks the extension from the content type', async () => {
    const jpeg = await uploadCheckinSelfie(Buffer.from('x'), 'image/jpeg');
    const png = await uploadCheckinSelfie(Buffer.from('x'), 'image/png');
    expect(jpeg.key.endsWith('.jpg')).toBe(true);
    expect(png.key.endsWith('.png')).toBe(true);
  });

  it('generates a distinct key per call', async () => {
    const a = await uploadCheckinSelfie(Buffer.from('x'), 'image/jpeg');
    const b = await uploadCheckinSelfie(Buffer.from('x'), 'image/jpeg');
    expect(a.key).not.toBe(b.key);
  });

  it('rejects a non-image content type', async () => {
    await expect(uploadCheckinSelfie(Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(
      UnsupportedImageTypeError,
    );
  });

  it('enforces the server-side size cap regardless of client compression', async () => {
    const oversized = Buffer.alloc(600 * 1024);
    await expect(uploadCheckinSelfie(oversized, 'image/jpeg')).rejects.toBeInstanceOf(SelfieTooLargeError);
  });
});
