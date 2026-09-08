/**
 * PNSM AI service client — TypeScript port of Person 4's reference
 * implementation (`Person4_AIBiometricService/clients/node/pnsmAiClient.js`),
 * kept behaviorally IDENTICAL (see DECISIONS.md N1). Do not hand-roll the HMAC
 * signing — a mismatch returns 401 with no diagnostic, deliberately, so it
 * cannot be debugged by trial and error.
 *
 * Owner of the contract: Person 4. Questions go to
 * Person4_AIBiometricService/docs/API.md.
 */
import crypto from 'node:crypto';

export interface PnsmAiErrorBody {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    request_id?: string;
    context?: unknown;
  };
}

/** Thrown for any non-2xx response. Carries the service's reason code (see API.md's table). */
export class PnsmAiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  requestId: string | null;
  context: unknown;

  constructor(status: number, body: PnsmAiErrorBody) {
    const error = body?.error ?? {};
    super(error.message || `PNSM AI service returned ${status}`);
    this.name = 'PnsmAiError';
    this.status = status;
    this.code = error.code || 'INTERNAL';
    this.retryable = Boolean(error.retryable);
    this.requestId = error.request_id ?? null;
    this.context = error.context ?? null;
  }
}

export interface PnsmAiClientOptions {
  baseUrl: string;
  hmacSecret: string;
  adminToken?: string;
  timeoutMs?: number;
}

export interface ImageRef {
  kind: 's3_key' | 'base64';
  value: string;
}

export interface EmbedResult {
  ok: boolean;
  envelope: Record<string, unknown>;
  storage_target: { collection: string; link_field: string };
  quality: {
    det_score: number;
    blur_var: number;
    face_area_ratio: number;
    brightness: number;
    faces_found: number;
  };
  warnings: string[];
  model_version: string;
  timings_ms: Record<string, number>;
}

export interface DeviceInfo {
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  isMockLocation?: boolean;
  isEmulator?: boolean;
  isRooted?: boolean;
}

export interface VerifyParams {
  userRef: string;
  image: ImageRef;
  envelope: Record<string, unknown>;
  requestId: string;
  capturedAt: string | Date;
  device: DeviceInfo;
}

export type DecisionBands = 'two' | 'three';

/** Item 3b — real but uncertified passive PAD heuristic (app/ai/passive_pad.py). */
export interface PassivePadResult {
  moire_energy_ratio: number;
  edge_sharpness: number;
  confidence: number;
}

export interface VerifyResult {
  decision: 'approved' | 'flagged' | 'rejected';
  confidence: number;
  raw_cosine: number;
  threshold: {
    approve: number;
    flag?: number;
    bands: DecisionBands;
    calibration_version: string;
    approve_at_cosine: number;
    flag_at_cosine?: number;
  };
  reason_code: string;
  hr_alert: boolean;
  quality: EmbedResult['quality'];
  passive_pad: PassivePadResult;
  model_version: string;
  image_hash: string;
  capture_skew_s: number;
  latency_ms: Record<string, number>;
}

export type LivenessColor = 'red' | 'green' | 'blue' | 'white';

export interface LivenessFrame {
  color: LivenessColor;
  image: ImageRef;
}

export interface LivenessChallengeParams {
  userRef: string;
  requestId: string;
  frames: LivenessFrame[];
}

export interface LivenessChallengeResult {
  passed: boolean;
  confidence: number;
  per_frame_scores: number[];
}

export interface PinHashResult {
  pin_hash: string;
  algo: string;
  cost: number;
  pepper_version: string;
}

export interface PinVerifyResult {
  match: boolean;
  locked: boolean;
  attempts_left: number;
  retry_after_s: number;
}

export interface PresignPutParams {
  userRef: string;
  purpose: string;
  objectId: string;
  contentType: string;
  contentLength: number;
}

export interface PresignPutResult {
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  object_key: string;
  expires_at: string;
  max_bytes: number;
}

export interface PresignGetResult {
  download_url?: string;
  [key: string]: unknown;
}

export interface ReadyResult {
  status: string;
  model_version: string;
  calibration_version: string;
  storage: string;
  warm: boolean;
  thresholds: Record<string, unknown>;
  warnings: string[];
  security: Record<string, unknown>;
  aws?: Record<string, unknown>;
}

export interface HealthResult {
  status: string;
  version: string;
  uptime_s: number;
}

export class PnsmAiClient {
  private readonly baseUrl: string;
  private readonly secret: Buffer;
  private readonly adminToken: string;
  private readonly timeoutMs: number;

  constructor({ baseUrl, hmacSecret, adminToken = '', timeoutMs = 10_000 }: PnsmAiClientOptions) {
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
   * Build the two auth headers. The signed payload is `${timestamp}.${rawBody}`
   * — the timestamp is inside the signature so a captured signature cannot be
   * replayed with a fresh time. Sign the exact bytes sent: re-serialising the
   * object changes them.
   */
  private headers(rawBody: Buffer, { admin = false }: { admin?: boolean } = {}): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', this.secret).update(`${timestamp}.`).update(rawBody).digest('hex');
    const out: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-PNSM-Timestamp': timestamp,
      'X-PNSM-Signature': `v1=${signature}`,
    };
    if (admin && this.adminToken) out['X-PNSM-Admin'] = this.adminToken;
    return out;
  }

  private async post<T>(path: string, payload: unknown, options: { admin?: boolean } = {}): Promise<T> {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: this.headers(rawBody, options),
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
    if (!response.ok) throw new PnsmAiError(response.status, body as PnsmAiErrorBody);
    return body as T;
  }

  private async get<T>(path: string, options: { admin?: boolean } = {}): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: 'GET',
      headers: this.headers(Buffer.alloc(0), options),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new PnsmAiError(response.status, body as PnsmAiErrorBody);
    return body as T;
  }

  /** Liveness. Cheap; safe to poll. Needs no signature but sending one is fine. */
  async health(): Promise<HealthResult> {
    const response = await fetch(this.baseUrl + '/health');
    return response.json() as Promise<HealthResult>;
  }

  /** Readiness, including model, calibration and warmup state. */
  async ready(): Promise<ReadyResult> {
    const response = await fetch(this.baseUrl + '/ready');
    return response.json() as Promise<ReadyResult>;
  }

  /**
   * Onboarding (FR-01). Store `result.envelope` verbatim in the collection
   * named by `result.storage_target` — FaceEmbeddings, NOT the Users document.
   * Do not reformat it and do not try to read it: the key never leaves the AI
   * service.
   */
  async embed(userRef: string, image: ImageRef, requestId: string): Promise<EmbedResult> {
    return this.post<EmbedResult>('/v1/embed', { user_ref: userRef, image, request_id: requestId });
  }

  /**
   * Check-in (FR-05, FR-07). Returns a decision, not an exception, whenever a
   * comparison completed. Everything else throws a PnsmAiError; branch on
   * `err.code`. Push the WebSocket alert off `result.hr_alert`, NOT off the
   * decision string.
   */
  async verify(params: VerifyParams): Promise<VerifyResult> {
    const { userRef, image, envelope, requestId, capturedAt, device } = params;
    return this.post<VerifyResult>('/v1/verify', {
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

  /**
   * Active-illumination liveness challenge (Flawless/Ultra blueprint Item 3).
   * Not ISO/IEC 30107-3 certified -- a real, own-built PAD heuristic. Returns
   * a decision, not an exception, whenever the frames could be read: branch
   * on `result.passed`, the authoritative liveness result.
   */
  async livenessChallenge(params: LivenessChallengeParams): Promise<LivenessChallengeResult> {
    const { userRef, requestId, frames } = params;
    return this.post<LivenessChallengeResult>('/v1/liveness/challenge', {
      user_ref: userRef,
      request_id: requestId,
      frames,
    });
  }

  /** Hash a new PIN (FR-06). Store the whole record on the employee document. */
  async hashPin(userRef: string, pin: string): Promise<PinHashResult> {
    return this.post<PinHashResult>('/v1/security/pin/hash', { user_ref: userRef, pin });
  }

  /**
   * Check a PIN. A wrong PIN is a normal 200 with `match: false`; once the
   * attempt budget is spent the call throws RATE_LIMITED and no comparison is
   * performed at all.
   */
  async verifyPin(userRef: string, pin: string, pinHash: string): Promise<PinVerifyResult> {
    return this.post<PinVerifyResult>('/v1/security/pin/verify', {
      user_ref: userRef,
      pin,
      pin_hash: pinHash,
    });
  }

  /**
   * Mint an upload URL for the mobile client or the dashboard. `contentLength`
   * must be the exact compressed byte count — it is signed into the URL, so
   * the bucket rejects a mismatch.
   */
  async presignPut(params: PresignPutParams): Promise<PresignPutResult> {
    const { userRef, purpose, objectId, contentType, contentLength } = params;
    return this.post<PresignPutResult>('/v1/storage/presign-put', {
      user_ref: userRef,
      purpose,
      object_id: objectId,
      content_type: contentType,
      content_length: contentLength,
    });
  }

  /** Short-lived read URL for the HR audit view. */
  async presignGet(objectKey: string): Promise<PresignGetResult> {
    return this.post<PresignGetResult>('/v1/storage/presign-get', { object_key: objectKey });
  }

  /** Reload calibration.json without a restart. Requires the admin token. */
  async recalibrate(): Promise<unknown> {
    return this.post('/v1/admin/recalibrate', {}, { admin: true });
  }

  /** Counters, latency summary and resident memory. Requires the admin token. */
  async metrics(): Promise<unknown> {
    return this.get('/metrics', { admin: true });
  }
}

/**
 * Crockford base32 ULID. Use one per check-in: it is the idempotency key and
 * the replay guard, so it must be fresh for every genuine attempt and reused
 * only when retrying the identical request.
 */
export function newUlid(): string {
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
