/**
 * Domain model shapes as returned over the wire. These mirror Person 2's
 * `types/models.ts` field-for-field where the two overlap (that file is the
 * documented source of truth per the architecture report §3), plus the
 * additions locked in the ADR: `pin_hash` presence, `server_timestamp` on
 * AttendanceLog, `leave_type` + LeaveBalance, and structured Shift days.
 *
 * These are DTO shapes, not Mongoose documents — see src/models for the
 * actual schemas/persistence layer.
 */
import type { RoleKey, RoleName, LeaveType, LeaveStatus, CheckType, AttendanceStatus } from '../constants';

export type ObjectIdString = string;
export type ISODateString = string;

export interface GeoJSONPoint {
  type: 'Point';
  /** ALWAYS [longitude, latitude]. Cross this boundary only through src/utils/geo.ts. */
  coordinates: [number, number];
}

export interface Permissions {
  [flag: string]: boolean | undefined;
}

export interface RoleDTO {
  _id: ObjectIdString;
  role_name: RoleName;
  permissions: Permissions;
}

/**
 * Internal only — never returned over the wire. `envelope` is Person 4's
 * opaque AES-256-GCM/KMS output, stored verbatim (DECISIONS.md N1/N8) — treat
 * it as unknown, never parse or reformat it.
 */
export interface FaceEmbeddingDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  envelope: unknown;
  model_version: string;
  created_at: ISODateString;
}

/**
 * Never serialize password_hash or pin_hash — enforced by Mongoose `select: false`
 * on the schema field, not merely by omitting them from this type.
 */
export interface UserDTO {
  _id: ObjectIdString;
  name: string;
  email: string;
  role_id: ObjectIdString;
  phone: string;
  employee_code?: string;
  department?: string;
  office_id?: ObjectIdString | null;
  role_name?: RoleName;
  is_active: boolean;
  reference_photo_url: string | null;
  // face_embedding is NOT on the user DTO. Biometric vectors moved to the
  // separate encrypted `face_embeddings` collection per the blueprint, and
  // must never be serialized to any client regardless.
  created_at: ISODateString;
}

export interface OfficeDTO {
  _id: ObjectIdString;
  office_name: string;
  address: string;
}

export interface GeofenceDTO {
  _id: ObjectIdString;
  office_id: ObjectIdString;
  location: GeoJSONPoint;
  radius_meters: number;
  office_name?: string;
}

export interface AttendanceLogDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  geofence_id: ObjectIdString;
  check_type: CheckType;
  timestamp: ISODateString;
  /** Receipt time — distinct from the device-reported `timestamp` (ADR / report §3). */
  server_timestamp: ISODateString;
  gps_location: GeoJSONPoint;
  mock_location_detected: boolean;
  liveness_passed: boolean;
  face_match_score: number;
  selfie_url: string | null;
  status: AttendanceStatus;
  employee_name?: string;
  employee_code?: string;
  office_name?: string;
}

export interface LeaveRequestDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  employee_name?: string;
  leave_type: LeaveType;
  from_date: ISODateString;
  to_date: ISODateString;
  reason: string;
  status: LeaveStatus;
  created_at: ISODateString;
}

export interface LeaveBalanceDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  leave_type: LeaveType;
  total: number;
  used: number;
}

export interface ShiftDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  start_time: string;
  end_time: string;
  /** Source of truth — 0=Sun..6=Sat. Never parsed back from the label (ADR-3). */
  days_of_week: number[];
  /** Derived display string, e.g. "Sun-Thu". Regenerated on save, never hand-authored. */
  days_of_week_label: string;
}

export interface NotificationDTO {
  _id: ObjectIdString;
  recipient_id: ObjectIdString;
  log_id: ObjectIdString | null;
  message: string;
  is_read: boolean;
  created_at: ISODateString;
}

export interface AuditLogEntryDTO {
  _id: ObjectIdString;
  actor_id: ObjectIdString;
  actor_name?: string;
  action: string;
  target: string;
  created_at: ISODateString;
}

export interface SpoofAlertDTO {
  _id: ObjectIdString;
  user_id: ObjectIdString;
  employee_name?: string;
  detected_at: ISODateString;
  reason: string;
  gps_location: GeoJSONPoint;
}

export interface PolicyDTO {
  face_match_threshold: number;
  default_radius_meters: number;
  late_arrival_cutoff: string;
  block_mock_location: boolean;
}

export interface BillingComponentDTO {
  name: string;
  cost: number;
}

export interface BillingDTO {
  plan: string;
  seats: number;
  monthly_cost_bdt: number;
  renewal_date: ISODateString;
  components: BillingComponentDTO[];
}

/** Authenticated principal — role-neutral identity shape (ADR-4). */
export interface SessionUserDTO {
  _id: ObjectIdString;
  name: string;
  email: string;
  role: RoleKey;
  role_name: RoleName;
  reference_photo_url: string | null;
}
