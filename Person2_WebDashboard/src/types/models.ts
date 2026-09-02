/**
 * Domain models — a 1:1 mirror of Person 3's MongoDB (v2) document schema.
 *
 * SOURCE OF TRUTH: "Updated-PNSM-Project-Proposal.pdf" §4.1 Collections & Fields.
 * If Person 3 changes a field, change it HERE first, then fix the type errors
 * the compiler reports. Do not patch shapes at the call site.
 *
 * COORDINATE CONVENTION (read this before touching anything spatial):
 *   Every GeoJSON `coordinates` tuple in this file is [longitude, latitude].
 *   Latitude-first sources must be converted ONLY through `@/lib/geo`.
 */

/** MongoDB ObjectId, serialised as a 24-char hex string over JSON. */
export type ObjectId = string;

/** ISO-8601 UTC timestamp string, e.g. "2026-07-25T03:02:11.000Z". */
export type ISODateString = string;

/** GeoJSON Point. `coordinates` is ALWAYS [longitude, latitude]. */
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

export type RoleName = 'Super Admin' | 'Admin' | 'Employee';

/** Normalised internal role key. Derived from RoleName via `@/lib/rbac`. */
export type RoleKey = 'super_admin' | 'admin_hr' | 'employee';

export interface Permissions {
  [flag: string]: boolean | undefined;
}

export interface Role {
  _id: ObjectId;
  role_name: RoleName;
  permissions: Permissions;
}

/**
 * Biometric embedding — stored in its OWN collection, never on the User document.
 *
 * WHY IT IS DECOUPLED
 * Mingling Personally Identifiable Information with biometric telemetry in a
 * single document violates data-protection practice: any query that reads a
 * user profile would pull the biometric vector with it, and a single overly
 * broad projection leaks both at once.
 *
 * The vector is additionally protected with Client-Side Field Level Encryption
 * (AES-256-GCM) before it reaches Atlas, with the key held in AWS KMS — so a
 * full database breach yields ciphertext. Person 4 owns that pipeline.
 *
 * THE ADMIN CONSOLE NEVER RECEIVES `vector_data`. It is not needed to render
 * anything, and requesting it would defeat the isolation. The API returns only
 * the non-sensitive metadata below, so HR can confirm a baseline exists and see
 * which model produced it.
 */
export interface FaceEmbeddingMeta {
  _id: ObjectId;
  user_id: ObjectId;
  model_version: string;
  created_at: ISODateString;
  /** Confirms the vector was encrypted before storage. Display-only. */
  encrypted: boolean;
}

export interface User {
  _id: ObjectId;
  name: string;
  email: string;
  /** Never sent to the client. Present in the type only to document the schema. */
  password_hash?: never;
  role_id: ObjectId;
  phone: string;
  /** S3 object URL (served via CloudFront) of the onboarding reference photo. */
  reference_photo_url: string | null;
  created_at: ISODateString;

  /**
   * Whether an embedding exists in the FaceEmbeddings collection. A boolean,
   * not the vector: the console needs to show "Enrolled" or "No baseline" and
   * nothing more.
   */
  has_face_embedding?: boolean;
  /** Non-sensitive embedding metadata, when the API chooses to include it. */
  face_embedding_meta?: FaceEmbeddingMeta | null;

  // ---- Fields the admin UI needs that are denormalised by the API ----------
  /** Human-readable employee code shown in the UI (e.g. "PNSM-0142"). */
  employee_code?: string;
  department?: string;
  office_id?: ObjectId | null;
  role_name?: RoleName;
  is_active?: boolean;
}

export interface Office {
  _id: ObjectId;
  office_name: string;
  address: string;
}

export interface Geofence {
  _id: ObjectId;
  office_id: ObjectId;
  /** 2dsphere-indexed. coordinates = [longitude, latitude]. */
  location: GeoJSONPoint;
  radius_meters: number;
  /** Denormalised by the API for table rendering. */
  office_name?: string;
}

export type CheckType = 'check_in' | 'check_out';
export type AttendanceStatus = 'approved' | 'flagged' | 'rejected';

export interface AttendanceLog {
  _id: ObjectId;
  user_id: ObjectId;
  geofence_id: ObjectId;
  check_type: CheckType;
  timestamp: ISODateString;
  /** Device coordinates at check-in. coordinates = [longitude, latitude]. */
  gps_location: GeoJSONPoint;
  /** Cosine-similarity score, 0-100. Auto-approves at >= 85 (FR-07). */
  face_match_score: number;
  selfie_url: string | null;
  status: AttendanceStatus;

  // ---- Denormalised for the live feed and log table -----------------------
  employee_name?: string;
  employee_code?: string;
  office_name?: string;
  /** True when the mobile client reported a mock-location provider (FR-05). */
  mock_location_detected?: boolean;
}

export interface Notification {
  _id: ObjectId;
  recipient_id: ObjectId;
  log_id: ObjectId;
  message: string;
  is_read: boolean;
  created_at: ISODateString;
}

export interface Shift {
  _id: ObjectId;
  user_id: ObjectId;
  start_time: string;
  end_time: string;
  /** e.g. "Sun-Thu" (Bangladesh working week). */
  days_of_week: string;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  _id: ObjectId;
  user_id: ObjectId;
  employee_name?: string;
  from_date: ISODateString;
  to_date: ISODateString;
  reason: string;
  status: LeaveStatus;
  created_at: ISODateString;
}

export interface AuditLogEntry {
  _id: ObjectId;
  actor_id: ObjectId;
  actor_name?: string;
  action: string;
  target: string;
  created_at: ISODateString;
}

export interface SpoofAlert {
  _id: ObjectId;
  user_id: ObjectId;
  employee_name?: string;
  detected_at: ISODateString;
  reason: string;
  gps_location: GeoJSONPoint;
}

/** Authenticated principal as the admin UI understands it. */
export interface SessionUser {
  _id: ObjectId;
  name: string;
  email: string;
  role: RoleKey;
  role_name: RoleName;
  reference_photo_url: string | null;
}
