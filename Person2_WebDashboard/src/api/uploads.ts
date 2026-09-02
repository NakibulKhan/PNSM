/**
 * Reference-photo uploads to AWS S3.
 *
 * WHY THE BROWSER CANNOT PRESIGN
 * ------------------------------
 * A presigned URL is a request signed with an AWS secret access key. In the
 * previous architecture a server runtime held that key. This is a pure static
 * SPA — there is no server, and anything shipped to the browser is public — so
 * the key cannot live here. Attempting it would publish write access to the
 * bucket in the JavaScript bundle.
 *
 * Person 3's Express API therefore mints the URL: it holds the IAM credentials
 * (injected by Person 4 through the ECS task definition), authenticates the
 * request with the same JWT middleware as every other route, and returns a
 * short-lived URL scoped to a single object key.
 *
 * The image itself then goes browser → S3 directly, never through Express.
 * That keeps a 15 MB original off the API entirely, avoids body-size limits,
 * and puts the transfer on CloudFront's edge rather than the container.
 */
import { api } from './client';

export interface PresignResult {
  /** 'demo' means no bucket is configured; skip the PUT and use `publicUrl`. */
  mode: 's3' | 'demo';
  uploadUrl: string | null;
  publicUrl: string;
  key: string;
}

/**
 * Ask the API for an upload URL.
 * `contentType` must be echoed back verbatim on the PUT, or S3 rejects the
 * signature — the header is part of what was signed.
 */
export async function requestUploadUrl(contentType: string): Promise<PresignResult> {
  const { data } = await api.post<PresignResult>('/uploads/presign', {
    contentType,
    purpose: 'reference_photo',
  });
  return data;
}

/**
 * PUT the compressed file straight to S3.
 *
 * Deliberately uses `fetch` rather than the shared Axios instance: this request
 * must NOT carry the Authorization header or the credentials flag. Sending our
 * JWT to Amazon would leak it to a third party, and an extra Authorization
 * header invalidates the S3 signature — producing a 403 that reads like a
 * permissions problem when it is actually a header problem.
 */
export async function putToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
    credentials: 'omit',
    mode: 'cors',
  });

  if (!response.ok) {
    throw new Error(
      `Upload to storage failed (${response.status}). If this is a CORS error, the S3 bucket needs this origin added to its CORS policy.`,
    );
  }
}
