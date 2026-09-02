/**
 * Transport-level contracts. Every response from Person 3's API is wrapped in
 * `ApiEnvelope`. Agreed in Week 1 — see docs/01-API-CONTRACT.md.
 */
import type {
  AttendanceLog,
  AttendanceStatus,
  ISODateString,
  ObjectId,
  SessionUser,
} from './models';

export interface ApiMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiEnvelope<T> {
  data: T;
  error: ApiError | null;
  meta?: ApiMeta;
}

export interface Paginated<T> {
  rows: T[];
  meta: ApiMeta;
}

/** GET /dashboard/kpis */
export interface DashboardKpis {
  checkedInToday: number;
  onLeave: number;
  lateArrivals: number;
  /** Mean face-match score across today's check-ins, 0-100. */
  avgFaceMatch: number;
  totalEmployees: number;
  flaggedToday: number;
}

/** GET /dashboard/trend?days=7 */
export interface TrendPoint {
  /** Dhaka-local calendar date, "YYYY-MM-DD". */
  date: string;
  count: number;
  label: string;
}

export interface AttendanceQuery {
  from?: ISODateString;
  to?: ISODateString;
  officeId?: ObjectId;
  employeeId?: ObjectId;
  status?: AttendanceStatus | 'all';
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * POST /auth/login.
 *
 * Note what is NOT here: the refresh token. Express delivers it as an HttpOnly,
 * Secure, SameSite=Strict `Set-Cookie` header in the same response, so the
 * browser stores it and JavaScript can never read it. If a refresh token ever
 * appears in this body, the XSS protection has been undone — treat it as a bug.
 */
export interface LoginResponse {
  user: SessionUser;
  accessToken: string;
}

/** Payloads pushed over Socket.IO. Event names live in `@/lib/constants`. */
export interface SocketEventMap {
  'attendance:new': AttendanceLog;
  'attendance:flagged': AttendanceLog;
  'spoof:alert': { _id: ObjectId; employee_name: string; detected_at: ISODateString; reason: string };
  'notification:new': { _id: ObjectId; message: string; created_at: ISODateString };
}
