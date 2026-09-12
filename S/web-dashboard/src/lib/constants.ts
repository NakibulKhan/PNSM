/** Cross-cutting constants. Change here, never inline. */

/** Business timezone. Every date the user sees is rendered in this zone. */
export const APP_TIMEZONE = 'Asia/Dhaka';

/** FR-07: check-ins at or above this score auto-approve; below it, HR reviews. */
export const FACE_MATCH_THRESHOLD = 85;

/** Reference photos must be compressed below this before upload. */
export const MAX_UPLOAD_MB = 0.2;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Keep enough facial detail for DeepFace while still hitting 200 KB. */
export const COMPRESSION_MAX_DIMENSION = 1080;
export const COMPRESSION_INITIAL_QUALITY = 0.8;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

/** Presigned R2 PUT lifetime, in seconds. */
export const PRESIGN_EXPIRY_SECONDS = 60;

/**
 * Token lifetimes, mirrored from Person 3's Express configuration so the client
 * can refresh proactively. The refresh token itself is never visible here — it
 * lives in an HttpOnly cookie the browser manages.
 */
export const ACCESS_TOKEN_TTL_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 7;

/** Socket.IO event names. Must match Person 3 exactly. */
export const SOCKET_EVENTS = {
  attendanceNew: 'attendance:new',
  attendanceFlagged: 'attendance:flagged',
  spoofAlert: 'spoof:alert',
  notificationNew: 'notification:new',
} as const;

/**
 * Must match Person 3's SOCKET_AUTH_FAILURE_MESSAGE (constants/index.ts)
 * exactly — use-socket.ts checks a connect_error against this to tell an
 * expired-token handshake rejection apart from a plain network drop.
 */
export const SOCKET_AUTH_FAILURE_MESSAGE = 'invalid credentials';

/** Default map view: Dhaka. [latitude, longitude] — Leaflet order. */
export const DEFAULT_MAP_CENTER: [number, number] = [23.7806, 90.4074];
export const DEFAULT_MAP_ZOOM = 12;
/**
 * Geofence radius bounds, in metres.
 * 50 m is the strict indoor-office default; 500 m suits an outdoor construction
 * site. The 1 km ceiling exists so a mis-drag cannot accidentally authorise
 * check-ins across half a city.
 */
export const DEFAULT_GEOFENCE_RADIUS = 50;
export const MIN_GEOFENCE_RADIUS = 10;
export const MAX_GEOFENCE_RADIUS = 1000;
export const RADIUS_PRESETS = [
  { label: 'Indoor office', meters: 50 },
  { label: 'Compound', meters: 150 },
  { label: 'Construction site', meters: 500 },
] as const;

export const DEFAULT_PAGE_SIZE = 20;
