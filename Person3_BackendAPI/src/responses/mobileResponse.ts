/**
 * ADR-1: mobile routes return BARE bodies, field-for-field matching
 * api-contract.md. Never wrap these in {data,error,meta} — that convention
 * is admin-only. This module exists so that guarantee is structural (one
 * place to change if it's ever wrong) rather than a per-handler judgment
 * call.
 */
import type { Response } from 'express';

export function mobileOk(res: Response, body: Record<string, unknown>, status = 200): void {
  res.status(status).json(body);
}

/**
 * Mobile errors carry meaning through HTTP status + a `reason` enum, per the
 * shared contract's error table (outside_geofence, mock_location_detected,
 * liveness_failed, pin_mismatch, low_face_match — plus this backend never
 * emits the client-only transport categories network_error/invalid_request,
 * those are synthesized client-side when a request never reaches the server
 * at all).
 *
 * `status` is derived from the HTTP status, not hardcoded: Person 1's own
 * client (interpretCheckinResponse) treats "rejected" (business-rule
 * failure — PIN/geofence/spoofing/liveness, the employee's fault) and
 * "error" (server/network failure, not the employee's fault) as visually and
 * semantically distinct outcomes. A 4xx here is always a business-rule
 * rejection; a 5xx is always a server error — collapsing that distinction
 * would misrepresent a backend fault as the employee having done something
 * wrong.
 */
export function mobileError(res: Response, status: number, reason: string, extra?: Record<string, unknown>): void {
  const outcome = status >= 500 ? 'error' : 'rejected';
  res.status(status).json({ status: outcome, reason, face_match_score: null, ...extra });
}
