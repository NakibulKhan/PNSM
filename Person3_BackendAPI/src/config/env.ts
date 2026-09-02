/**
 * Single typed entry point for every environment variable this backend reads.
 * Nothing outside this file should touch `process.env` directly — mirrors the
 * discipline Person 2's own `lib/env.ts` documents on their side (see the
 * architecture report, §9 / Bug Bible #11): read env vars in exactly one
 * place, fail loudly and early if something required is missing, never leak
 * a secret into a log line.
 */
import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    // Fail at boot, not at first use — a missing required var should never
    // surface as a mysterious runtime error three requests later.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const NODE_ENV = optional('NODE_ENV', 'development');
export const IS_TEST = NODE_ENV === 'test';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const PORT = optionalInt('PORT', 5000);

/** Never required in test — the test suite mocks the persistence layer (see tests/README notes). */
export const MONGODB_URI = IS_TEST
  ? optional('MONGODB_URI', 'mongodb://127.0.0.1:27017/pnsm_test')
  : required('MONGODB_URI');

export const JWT_ACCESS_SECRET = IS_TEST
  ? optional('JWT_ACCESS_SECRET', 'test-access-secret')
  : required('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = IS_TEST
  ? optional('JWT_REFRESH_SECRET', 'test-refresh-secret')
  : required('JWT_REFRESH_SECRET');
export const JWT_ACCESS_TTL = optional('JWT_ACCESS_TTL', '15m');
/** Blueprint mandates a 7-day refresh token (was 30d). */
export const JWT_REFRESH_TTL = optional('JWT_REFRESH_TTL', '7d');

/**
 * 'RS256' (asymmetric, blueprint's production preference) or 'HS256'
 * (symmetric, default for local/dev because RS256 needs a keypair to exist
 * before the server can boot). Under RS256 the two PEM keys below are used
 * and JWT_ACCESS_SECRET/JWT_REFRESH_SECRET are ignored.
 */
export const JWT_ALGORITHM = (optional('JWT_ALGORITHM', 'HS256') === 'RS256' ? 'RS256' : 'HS256') as
  | 'RS256'
  | 'HS256';
/** PEM-encoded. Supports \n escapes so the key can live on one .env line. */
export const JWT_PRIVATE_KEY = optional('JWT_PRIVATE_KEY', '').replace(/\\n/g, '\n');
export const JWT_PUBLIC_KEY = optional('JWT_PUBLIC_KEY', '').replace(/\\n/g, '\n');

export const BCRYPT_SALT_ROUNDS = optionalInt('BCRYPT_SALT_ROUNDS', 12);

/**
 * Admin console origins allowed for Socket.IO (see architecture report §8).
 * REST needs no CORS at all — Person 2 calls the backend server-to-server.
 */
export const ADMIN_ALLOWED_ORIGINS = optional(
  'ADMIN_ALLOWED_ORIGINS',
  'http://localhost:3000',
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Capacitor origins for the mobile client. IMPORTANT CHANGE: under the
 * blueprint, Person 1's app is a Vite/React build running inside a Capacitor
 * WebView — that is a browser, so its REST calls ARE subject to CORS. This
 * was NOT true of the original Flutter/React-Native plan, where the native
 * HTTP client bypassed CORS entirely. Android WebViews present
 * 'http://localhost', iOS presents 'capacitor://localhost'.
 */
export const MOBILE_ALLOWED_ORIGINS = optional(
  'MOBILE_ALLOWED_ORIGINS',
  'capacitor://localhost,http://localhost,ionic://localhost,http://localhost:5173',
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const ALLOWED_ORIGINS = [...new Set([...ADMIN_ALLOWED_ORIGINS, ...MOBILE_ALLOWED_ORIGINS])];

/**
 * Public base URL used to build a display link for a presigned admin
 * reference-photo upload (see `uploadService.ts#presignAdminUpload`).
 * Everything else about object storage — bucket, credentials, presigning —
 * is owned entirely by Person 4's AI service (DECISIONS.md N2); this is the
 * one storage-shaped value this backend still needs directly.
 */
export const STORAGE_PUBLIC_BASE_URL = optional(
  'STORAGE_PUBLIC_BASE_URL',
  optional('R2_PUBLIC_BASE_URL', ''),
);

/**
 * Person 4's AI service (PIN hash/verify, face embed/verify, upload presigning —
 * see DECISIONS.md N1/N2). Not required outside test so the rest of the app can
 * boot and be typechecked before the service is actually running locally; every
 * call site surfaces a clear connection error rather than this file throwing at
 * import time.
 */
export const PNSM_AI_URL = optional('PNSM_AI_URL', 'http://localhost:8000');
export const PNSM_HMAC_SECRET = optional(
  'PNSM_HMAC_SECRET',
  // 32 zero bytes, base64-encoded — a valid-shaped local dev default so
  // PnsmAiClient's constructor (which insists on a 32-byte secret) never
  // throws at boot. Never valid against a real deployment of the AI service,
  // which will reject every request with 401 until the real shared secret
  // from Person 4 is set.
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
);

export const APP_TIMEZONE = 'Asia/Dhaka';

export const BCRYPT_PIN_SALT_ROUNDS = optionalInt('BCRYPT_PIN_SALT_ROUNDS', 10);
