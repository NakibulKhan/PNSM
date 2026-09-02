/**
 * Check-in selfie upload (ADR-7, revised for the blueprint).
 *
 * The v2 proposal specifies Cloudflare R2; the blueprint specifies AWS S3.
 * Both speak the S3 API, so this is one endpoint-configurable service rather
 * than two implementations — switching providers is an env change, not a code
 * change. Person 4 owns the credentials either way.
 *
 * Mobile posts the selfie as multipart to THIS backend (a Capacitor WebView
 * cannot hold long-lived storage credentials safely), so the upload is
 * server-to-server and needs no bucket CORS entry. That is only required for
 * Person 2's browser-direct reference-photo PUTs.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import {
  STORAGE_PROVIDER,
  STORAGE_ACCOUNT_ID,
  STORAGE_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY,
  STORAGE_BUCKET,
  STORAGE_REGION,
  STORAGE_PUBLIC_BASE_URL,
  STORAGE_CHECKIN_PREFIX,
  MAX_SELFIE_BYTES,
  isStorageConfigured,
} from '../../config/env';
import { logger } from '../../utils/logger';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: STORAGE_PROVIDER === 'r2' ? 'auto' : STORAGE_REGION,
    // R2 needs an explicit account endpoint; S3 derives its own from region.
    ...(STORAGE_PROVIDER === 'r2'
      ? { endpoint: `https://${STORAGE_ACCOUNT_ID}.r2.cloudflarestorage.com` }
      : {}),
    credentials: {
      accessKeyId: STORAGE_ACCESS_KEY_ID,
      secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
    },
    // R2 does not implement the integrity checksums the AWS SDK started
    // sending by default in v3.729.0+, which breaks PutObject with a CRC32
    // error. Harmless against real S3, required against R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

export interface UploadResult {
  mode: 'uploaded' | 'unconfigured';
  url: string;
  key: string;
}

export class SelfieTooLargeError extends Error {
  constructor(public actualBytes: number) {
    super('Selfie exceeds the maximum allowed size');
    this.name = 'SelfieTooLargeError';
  }
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);

export class UnsupportedImageTypeError extends Error {
  constructor(public contentType: string) {
    super('Unsupported image type');
    this.name = 'UnsupportedImageTypeError';
  }
}

export async function uploadCheckinSelfie(buffer: Buffer, contentType: string): Promise<UploadResult> {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new UnsupportedImageTypeError(contentType);
  }
  // Server-side size enforcement. Person 1 compresses client-side to <200KB,
  // but a client-side limit is a UX optimisation, not a control — anyone can
  // post directly to this endpoint.
  if (buffer.byteLength > MAX_SELFIE_BYTES) {
    throw new SelfieTooLargeError(buffer.byteLength);
  }

  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `${STORAGE_CHECKIN_PREFIX}${randomUUID()}.${extension}`;

  if (!isStorageConfigured()) {
    // Never fake a successful upload — the caller must be able to tell.
    logger.warn('Object storage not configured — selfie not persisted', { key });
    return { mode: 'unconfigured', url: '', key };
  }

  await getClient().send(
    new PutObjectCommand({ Bucket: STORAGE_BUCKET, Key: key, Body: buffer, ContentType: contentType }),
  );

  return { mode: 'uploaded', url: `${STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`, key };
}
