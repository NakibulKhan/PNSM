/**
 * Presigned-upload proxy (DECISIONS.md N2). Person 4 owns the bucket,
 * CORS, and presigning entirely — this backend never holds storage
 * credentials or touches image bytes, it just forwards an authenticated
 * request to Person 4's AI service and reshapes the response for each caller.
 */
import { getAiClient, newUlid } from './aiClient';
import { STORAGE_PUBLIC_BASE_URL } from '../config/env';

export interface AdminPresignResult {
  mode: 's3';
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

/** Admin console reference-photo uploads — matches 01-API-CONTRACT.md's POST /uploads/presign shape. */
export async function presignAdminUpload(
  userRef: string,
  contentType: string,
): Promise<AdminPresignResult> {
  const ai = getAiClient();
  const result = await ai.presignPut({
    userRef,
    purpose: 'reference',
    objectId: newUlid(),
    contentType,
    // The admin console presigns before it knows the final byte count (the
    // browser hasn't read the file yet) — 5 MB is a generous ceiling for a
    // single reference photo; Person 4's service still enforces its own
    // PNSM_MAX_UPLOAD_BYTES server-side regardless of what is requested here.
    contentLength: 5 * 1024 * 1024,
  });
  return {
    mode: 's3',
    uploadUrl: result.upload_url,
    publicUrl: STORAGE_PUBLIC_BASE_URL ? `${STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${result.object_key}` : '',
    key: result.object_key,
  };
}

/** Mobile check-in selfie uploads — DECISIONS.md N2/N5. */
export async function presignMobileUpload(
  userRef: string,
  purpose: 'checkin' | 'reference',
  contentType: string,
  contentLength: number,
) {
  const ai = getAiClient();
  return ai.presignPut({ userRef, purpose, objectId: newUlid(), contentType, contentLength });
}

/** HR audit view — short-lived read URL for a stored selfie's object key. */
export async function presignSelfieView(objectKey: string) {
  const ai = getAiClient();
  return ai.presignGet(objectKey);
}
