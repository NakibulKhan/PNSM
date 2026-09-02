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
  contentLength: number,
): Promise<AdminPresignResult> {
  const ai = getAiClient();
  const result = await ai.presignPut({
    userRef,
    purpose: 'reference',
    objectId: newUlid(),
    contentType,
    // The real, already-compressed byte count — the browser compresses the
    // photo client-side (to the same PNSM_MAX_UPLOAD_BYTES/200KB budget
    // check-in selfies target, per Person 2's own MAX_UPLOAD_MB constant)
    // BEFORE calling this endpoint, so the size is genuinely known here.
    // A prior version of this code hardcoded a 5MB guess instead, which
    // Person 4's presign-put unconditionally rejects as PAYLOAD_TOO_LARGE
    // (413) since it exceeds PNSM_MAX_UPLOAD_BYTES — that made every single
    // admin-console reference-photo upload fail, caught only by an actual
    // live end-to-end run (ROADMAP.md Phase 5), never by any test, since no
    // test exercised the real AI service's presign-put size check.
    contentLength,
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
