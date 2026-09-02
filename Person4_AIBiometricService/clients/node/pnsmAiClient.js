/**
 * PNSM AI service client for Person 3's Node.js backend.
 *
 * Copy this file into your project. Zero dependencies -- Node 18+ built-ins only.
 * The signing logic here is the reference implementation: if you sign requests
 * a different way, they will be rejected with 401.
 *
 *   const { PnsmAiClient } = require('./pnsmAiClient');
 *
 *   const ai = new PnsmAiClient({
 *     baseUrl: process.env.PNSM_AI_URL,       // the AI service's private DNS name
 *     hmacSecret: process.env.PNSM_HMAC_SECRET // base64, from Person 4
 *   });
 *
 * Owner: Person 4. Questions about the contract go to docs/API.md.
 */

'use strict';

const crypto = require('node:crypto');

/** Thrown for any non-2xx response. Carries the service's reason code. */
class PnsmAiError extends Error {
  constructor(status, body) {
    const error = (body && body.error) || {};
    super(error.message || `PNSM AI service returned ${status}`);
    this.name = 'PnsmAiError';
    this.status = status;
    /** A member of the reason-code table in docs/API.md. Branch on this. */
    this.code = error.code || 'INTERNAL';
    /** True when retrying the identical request could succeed. */
    this.retryable = Boolean(error.retryable);
    this.requestId = error.request_id || null;
    this.context = error.context || null;
  }
}

class PnsmAiClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl      Service base URL, no trailing slash.
   * @param {string} options.hmacSecret   Base64 32-byte shared secret.
   * @param {string} [options.adminToken] Only needed for /metrics and /v1/admin/*.
   * @param {number} [options.timeoutMs]  Per-request timeout. Default 10000.
   */
  constructor({ baseUrl, hmacSecret, adminToken = '', timeoutMs = 10_000 }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!hmacSecret) throw new Error('hmacSecret is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.secret = Buffer.from(hmacSecret, 'base64');
    if (this.secret.length !== 32) {
      throw new Error(`hmacSecret must decode to 32 bytes, got ${this.secret.length}`);
    }
    this.adminToken = adminToken;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Build the two auth headers.
   *
   * The signed payload is `${timestamp}.${rawBody}` -- the timestamp is inside
   * the signature so a captured signature cannot be replayed with a fresh time.
   * Sign the exact bytes you send: re-serialising the object changes them.
   */
  _headers(rawBody, { admin = false } = {}) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const headers = {
      'Content-Type': 'application/json',
      'X-PNSM-Timestamp': timestamp,
      'X-PNSM-Signature': `v1=${signature}`,
    };
    if (admin && this.adminToken) headers['X-PNSM-Admin'] = this.adminToken;
    return headers;
  }

  async _post(path, payload, options = {}) {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: this._headers(rawBody, options),
        body: rawBody,
        signal: controller.signal,
      });
    } catch (cause) {
      // A network failure is retryable; surface it in the same shape as
      // everything else so callers need only one error path.
      throw new PnsmAiError(0, {
        error: { code: 'UPSTREAM_STORAGE_ERROR', message: String(cause), retryable: true },
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new PnsmAiError(response.status, body);
    return body;
  }

  async _get(path, options = {}) {
    const response = await fetch(this.baseUrl + path, {
      method: 'GET',
      headers: this._headers(Buffer.alloc(0), options),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new PnsmAiError(response.status, body);
    return body;
  }

  /** Liveness. Cheap; safe to poll. Needs no signature but sending one is fine. */
  async health() {
    const response = await fetch(this.baseUrl + '/health');
    return response.json();
  }

  /** Readiness, including model, calibration and warmup state. */
  async ready() {
    const response = await fetch(this.baseUrl + '/ready');
    return response.json();
  }

  /**
   * Onboarding (FR-01). Store `result.envelope` verbatim in the collection
   * named by `result.storage_target` -- FaceEmbeddings, NOT the Users document.
   * Do not reformat it and do not try to read it: the key never leaves the AI
   * service, and under the KMS provider the data key is unwrapped only there.
   *
   * @param {string} userRef    Employee _id as a string.
   * @param {object} image      { kind: 's3_key' | 'base64', value: string }
   * @param {string} requestId  A 26-character ULID.
   */
  async embed(userRef, image, requestId) {
    return this._post('/v1/embed', { user_ref: userRef, image, request_id: requestId });
  }

  /**
   * Check-in (FR-05, FR-07).
   *
   * Returns a decision, not an exception, whenever a comparison completed:
   * `approved`, `rejected`, or -- only under the three-band policy -- `flagged`.
   * Everything else throws a PnsmAiError; branch on `err.code`.
   *
   * Push the WebSocket alert off `result.hr_alert`, NOT off the decision
   * string. It is true for anything short of a clean approval under either
   * band policy, so the alerting survives a policy change.
   *
   * `confidence` is the calibrated similarity score as a percentage, not
   * `cosine * 100`; `raw_cosine` is the audit trail and must never be shown to
   * an employee.
   */
  async verify({ userRef, image, envelope, requestId, capturedAt, device }) {
    return this._post('/v1/verify', {
      user_ref: userRef,
      image,
      envelope,
      request_id: requestId,
      captured_at: capturedAt instanceof Date ? capturedAt.toISOString() : capturedAt,
      device: {
        platform: device?.platform ?? 'unknown',
        os_version: device?.osVersion ?? '',
        app_version: device?.appVersion ?? '',
        is_mock_location: Boolean(device?.isMockLocation),
        is_emulator: Boolean(device?.isEmulator),
        is_rooted: Boolean(device?.isRooted),
      },
    });
  }

  /** Hash a new PIN (FR-06). Store the whole record on the employee document. */
  async hashPin(userRef, pin) {
    return this._post('/v1/security/pin/hash', { user_ref: userRef, pin });
  }

  /**
   * Check a PIN. A wrong PIN is a normal 200 with `match: false`; once the
   * attempt budget is spent the call throws RATE_LIMITED and no comparison is
   * performed at all.
   */
  async verifyPin(userRef, pin, pinHash) {
    return this._post('/v1/security/pin/verify', {
      user_ref: userRef,
      pin,
      pin_hash: pinHash,
    });
  }

  /**
   * Mint an upload URL for the mobile client or the dashboard.
   * `contentLength` must be the exact compressed byte count -- it is signed
   * into the URL, so the bucket rejects a mismatch.
   */
  async presignPut({ userRef, purpose, objectId, contentType, contentLength }) {
    return this._post('/v1/storage/presign-put', {
      user_ref: userRef,
      purpose,
      object_id: objectId,
      content_type: contentType,
      content_length: contentLength,
    });
  }

  /** Short-lived read URL for the HR audit view. */
  async presignGet(objectKey) {
    return this._post('/v1/storage/presign-get', { object_key: objectKey });
  }

  /** Reload calibration.json without a restart. Requires the admin token. */
  async recalibrate() {
    return this._post('/v1/admin/recalibrate', {}, { admin: true });
  }

  /** Counters, latency summary and resident memory. Requires the admin token. */
  async metrics() {
    return this._get('/metrics', { admin: true });
  }
}

/**
 * Crockford base32 ULID. Use one per check-in: it is the idempotency key and
 * the replay guard, so it must be fresh for every genuine attempt and reused
 * only when retrying the identical request.
 */
function newUlid() {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i += 1) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = crypto.randomBytes(16);
  let randomPart = '';
  for (let i = 0; i < 16; i += 1) randomPart += ALPHABET[random[i] % 32];
  return timePart + randomPart;
}

module.exports = { PnsmAiClient, PnsmAiError, newUlid };
