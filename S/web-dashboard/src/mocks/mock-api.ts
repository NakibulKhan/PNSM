/**
 * In-process mock of Person 3's backend.
 *
 * It implements exactly the contract in docs/01-API-CONTRACT.md, so switching
 * VITE_DEMO_MODE from 1 to 0 swaps this for the real API with no code
 * change anywhere else in the app.
 *
 * Two jobs:
 *   1. Weeks 1-4: build and demo every screen before the backend exists.
 *   2. Demo day: the fallback if Render is cold, the venue WiFi is hostile, or
 *      Atlas is unreachable. The presentation never depends on someone else's
 *      uptime.
 *
 * State lives in memory for the life of the Node process. Restarting the dev
 * server resets it — that is intentional and keeps the demo reproducible.
 */
import { buildSeed, type SeedData } from './seed';
import { ACCESS_TOKEN_TTL_MINUTES, FACE_MATCH_THRESHOLD } from '@/lib/constants';
import { isLateArrival, lastNDhakaDateKeys, toDhakaDateKey } from '@/lib/tz';
import { toRoleKey } from '@/lib/rbac';
import type {
  AttendanceLog,
  AttendanceStatus,
  Geofence,
  LeaveRequest,
  Office,
  SessionUser,
  User,
} from '@/types/models';
import type { DashboardKpis, TrendPoint } from '@/types/api';

export interface MockResult {
  status: number;
  body: unknown;
}

/**
 * Demo session state, standing in for the HttpOnly refresh cookie Express would
 * set.
 *
 * WHY sessionStorage AND NOT A MODULE VARIABLE
 * --------------------------------------------
 * This used to be a plain module-scoped variable. That made demo mode diverge
 * from the real system in exactly the place the E2E suite tests: a real refresh
 * cookie is held by the BROWSER and therefore survives a reload or a hard
 * navigation to a deep link, so `bootstrapSession()` silently restores the
 * session. A module variable dies with the JS context, so every reload 401'd
 * and dumped the user at /login — and five Playwright specs (including the one
 * whose entire purpose is the deep-link regression) failed for a reason that
 * does not exist in production. Found by the final master audit, on the suite's
 * first-ever run.
 *
 * sessionStorage matches the real cookie's lifetime closely: it survives reload
 * and in-tab navigation, and it dies when the tab closes.
 *
 * What is stored is ONLY the fact that a session exists, plus which user it is
 * for — the same information the opaque cookie represents. No token is ever
 * written here: access tokens are still minted in memory, per request, by
 * `makeDemoAccessToken`. The production invariant ("no token in web storage")
 * is untouched, and none of this code ships outside demo mode.
 */
const DEMO_SESSION_KEY = 'pnsm-demo-session';

function readDemoSession(): string {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY) ?? '';
  } catch {
    // Private mode, blocked storage, or a non-DOM context (unit tests).
    return '';
  }
}

function writeDemoSession(userId: string): void {
  try {
    if (userId) sessionStorage.setItem(DEMO_SESSION_KEY, userId);
    else sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    // Non-fatal: falls back to the in-memory value below.
  }
}

let demoSessionUserId = readDemoSession();
let demoSessionActive = Boolean(demoSessionUserId);

function setDemoSession(userId: string): void {
  demoSessionUserId = userId;
  demoSessionActive = Boolean(userId);
  writeDemoSession(userId);
}

/**
 * Mint a structurally valid, UNSIGNED JWT for demo mode.
 *
 * It carries a real `exp` claim so the client's proactive-refresh logic and the
 * token-expiry decoder are exercised exactly as they will be in production.
 * It is not signed and would be rejected by any real verifier — which is the
 * point: demo mode must never produce a token that could be mistaken for one.
 */
function makeDemoAccessToken(userId: string): string {
  const base64url = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const body = base64url({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_MINUTES * 60,
    demo: true,
  });
  return `${header}.${body}.demo-not-a-real-signature`;
}

let store: SeedData | null = null;

function db(): SeedData {
  if (!store) store = buildSeed(new Date());
  return store;
}

/** Exposed for tests and for the "reset demo data" control in Settings. */
export function resetMockStore(): void {
  store = buildSeed(new Date());
  setDemoSession('');
}

const ok = (data: unknown, meta?: unknown): MockResult => ({
  status: 200,
  body: meta ? { data, error: null, meta } : { data, error: null },
});

const created = (data: unknown): MockResult => ({ status: 201, body: { data, error: null } });

const fail = (status: number, code: string, message: string): MockResult => ({
  status,
  body: { data: null, error: { code, message } },
});

function newId(prefix: string): string {
  const random = Math.random().toString(16).slice(2);
  return (prefix + random + '0'.repeat(24)).slice(0, 24);
}

function toSessionUser(user: User): SessionUser {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: toRoleKey(user.role_name ?? 'Employee'),
    role_name: user.role_name ?? 'Employee',
    reference_photo_url: user.reference_photo_url,
  };
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    meta: { page, pageSize, total: rows.length },
  };
}

function officeNameFor(id: string | null | undefined, offices: Office[]): string {
  return offices.find((office) => office._id === id)?.office_name ?? '—';
}

/**
 * Mirrors Person3's shiftDays.ts parseWeekLabel() just enough for the four
 * fixed range options employee-form.tsx's "Working days" select actually
 * sends ("Sun-Thu", "Sat-Wed", "Mon-Fri", "Sun-Fri") — ADR-3's number[] is the
 * source of truth, the label is derived, and the mock must store both so
 * days_of_week isn't a bare string the way it was before M3's fix.
 */
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function parseWeekLabel(label: string): number[] {
  const match = /^([A-Za-z]{3})-([A-Za-z]{3})$/.exec(label.trim());
  if (!match) return [0, 1, 2, 3, 4];
  const start = WEEKDAY_INDEX[match[1].toLowerCase()];
  const end = WEEKDAY_INDEX[match[2].toLowerCase()];
  if (start === undefined || end === undefined) return [0, 1, 2, 3, 4];
  const days: number[] = [];
  for (let i = start, count = 0; count < 7; i = (i + 1) % 7, count += 1) {
    days.push(i);
    if (i === end) break;
  }
  return days;
}

// --------------------------------------------------------------- dashboard --
function computeKpis(): DashboardKpis {
  const data = db();
  const todayKey = toDhakaDateKey(new Date());
  const todayLogs = data.attendance.filter(
    (log) => toDhakaDateKey(log.timestamp) === todayKey && log.check_type === 'check_in',
  );
  const distinct = new Set(todayLogs.map((log) => log.user_id));
  const scores = todayLogs.map((log) => log.face_match_score);
  const now = Date.now();
  const onLeave = data.leave.filter(
    (request) =>
      request.status === 'approved' &&
      new Date(request.from_date).getTime() <= now &&
      new Date(request.to_date).getTime() >= now - 86_400_000,
  ).length;

  return {
    checkedInToday: distinct.size,
    onLeave,
    lateArrivals: todayLogs.filter((log) => isLateArrival(log.timestamp)).length,
    // Rounded to a whole number to match the real dashboardService.ts exactly
    // (Math.round, not one decimal place) — see kpi-chips.tsx's M9 fix.
    avgFaceMatch: scores.length
      ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
      : 0,
    totalEmployees: data.employees.length,
    flaggedToday: todayLogs.filter((log) => log.status === 'flagged').length,
  };
}

function computeTrend(days: number): TrendPoint[] {
  const data = db();
  const keys = lastNDhakaDateKeys(days);
  return keys.map((key) => {
    const count = new Set(
      data.attendance
        .filter((log) => log.check_type === 'check_in' && toDhakaDateKey(log.timestamp) === key)
        .map((log) => log.user_id),
    ).size;
    const [, month, day] = key.split('-');
    return { date: key, count, label: `${day}/${month}` };
  });
}

// -------------------------------------------------------------- attendance --
function filterAttendance(params: URLSearchParams) {
  const data = db();
  const from = params.get('from');
  const to = params.get('to');
  const officeId = params.get('officeId');
  const employeeId = params.get('employeeId');
  const status = params.get('status');
  const search = params.get('search')?.toLowerCase().trim();

  return data.attendance.filter((log) => {
    if (from && log.timestamp < from) return false;
    if (to && log.timestamp > to) return false;
    if (employeeId && log.user_id !== employeeId) return false;
    if (status && status !== 'all' && log.status !== status) return false;
    if (officeId) {
      const geofence = data.geofences.find((fence) => fence._id === log.geofence_id);
      if (!geofence || geofence.office_id !== officeId) return false;
    }
    if (search) {
      const haystack = `${log.employee_name ?? ''} ${log.employee_code ?? ''} ${log.office_name ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** Employees whose most recent event today is a check-in. */
function liveMapPoints() {
  const data = db();
  const todayKey = toDhakaDateKey(new Date());
  const latestByUser = new Map<string, AttendanceLog>();
  data.attendance
    .filter((log) => toDhakaDateKey(log.timestamp) === todayKey)
    .forEach((log) => {
      const current = latestByUser.get(log.user_id);
      if (!current || log.timestamp > current.timestamp) latestByUser.set(log.user_id, log);
    });

  // L4: returns the full AttendanceLog shape (matching Person3's getLiveMap(),
  // which maps through the same toAttendanceRowDTO() every other attendance
  // row uses) rather than a hand-picked subset — that subset is exactly what
  // drifted from the real contract on the frontend's LivePresence type.
  return Array.from(latestByUser.values())
    .filter((log) => log.check_type === 'check_in')
    .map((log) => ({
      ...log,
      employee_name: log.employee_name ?? 'Unknown',
      employee_code: log.employee_code ?? '',
      office_name: log.office_name ?? '',
    }));
}

// ------------------------------------------------------------------ router --
export function handleMockRequest(
  method: string,
  path: string,
  params: URLSearchParams,
  body: unknown,
): MockResult {
  const data = db();
  const segments = path.replace(/^\/+|\/+$/g, '').split('/');
  const [root, second, third] = segments;
  const page = Number(params.get('page') ?? 1) || 1;
  const pageSize = Number(params.get('pageSize') ?? 20) || 20;
  const payload = (body ?? {}) as Record<string, unknown>;

  // ---- auth ---------------------------------------------------------------
  if (root === 'auth') {
    if (second === 'login' && method === 'POST') {
      const email = String(payload.email ?? '').toLowerCase();
      const password = String(payload.password ?? '');
      const user = data.users.find((candidate) => candidate.email.toLowerCase() === email);
      const roleKey = user ? toRoleKey(user.role_name ?? 'Employee') : null;
      if (!user || password.length < 6) {
        return fail(401, 'INVALID_CREDENTIALS', 'That email and password combination is not recognised.');
      }
      if (roleKey === 'employee') {
        return fail(403, 'NOT_ADMIN', 'This portal is for HR and Super Admin accounts. Employees use the mobile app.');
      }
      setDemoSession(user._id);
      /*
       * Only the access token is returned in the body. The refresh token would
       * be delivered as an HttpOnly Set-Cookie header by Express, which is why
       * it is deliberately absent here — the client must never see it.
       */
      return ok({
        user: toSessionUser(user),
        accessToken: makeDemoAccessToken(user._id),
      });
    }
    /*
     * In the real system this endpoint authenticates using the HttpOnly refresh
     * cookie the browser sends automatically, and Express rotates the pair.
     * The mock always succeeds, which lets the boot-time silent refresh and the
     * 401 replay path be exercised end to end with no backend.
     */
    if (second === 'refresh' && method === 'POST') {
      if (!demoSessionActive) {
        return fail(401, 'NO_REFRESH_TOKEN', 'Sign in again to continue.');
      }
      return ok({ accessToken: makeDemoAccessToken(demoSessionUserId) });
    }

    if (second === 'logout' && method === 'POST') {
      // Clears the simulated cookie too — otherwise a reload after sign-out
      // would silently sign the user back in.
      setDemoSession('');
      return ok({ signedOut: true });
    }

    if (second === 'me' && method === 'GET') {
      const user =
        data.users.find((candidate) => candidate._id === demoSessionUserId) ?? data.users[0];
      return ok(toSessionUser(user));
    }
  }

  // ---- S3 presigning (Person 3 mints this in production) ------------------
  if (root === 'uploads' && second === 'presign' && method === 'POST') {
    const contentType = String(payload.contentType ?? 'image/jpeg');
    if (!['image/jpeg', 'image/png'].includes(contentType)) {
      return fail(422, 'UNSUPPORTED_TYPE', 'Reference photos must be JPEG or PNG.');
    }
    return ok({
      mode: 'demo',
      uploadUrl: null,
      publicUrl: '/reference-placeholder.svg',
      key: `references/${newId('k')}.jpg`,
    });
  }

  // ---- dashboard ----------------------------------------------------------
  if (root === 'dashboard') {
    if (second === 'kpis') return ok(computeKpis());
    if (second === 'trend') return ok(computeTrend(Number(params.get('days') ?? 7) || 7));
  }

  // ---- employees ----------------------------------------------------------
  if (root === 'employees') {
    if (!second && method === 'GET') {
      const search = params.get('search')?.toLowerCase().trim();
      const officeId = params.get('officeId');
      let rows = data.employees;
      if (officeId) rows = rows.filter((employee) => employee.office_id === officeId);
      if (search) {
        rows = rows.filter((employee) =>
          `${employee.name} ${employee.employee_code} ${employee.email} ${employee.department}`
            .toLowerCase()
            .includes(search),
        );
      }
      const decorated = rows.map((employee) => ({
        ...employee,
        office_name: officeNameFor(employee.office_id, data.offices),
      }));
      const result = paginate(decorated, page, pageSize);
      return ok(result.rows, result.meta);
    }

    if (!second && method === 'POST') {
      const office = data.offices.find((candidate) => candidate._id === payload.office_id);
      const employee: User = {
        _id: newId('e'),
        name: String(payload.name ?? 'Unnamed'),
        email: String(payload.email ?? ''),
        role_id: data.users[0].role_id,
        role_name: 'Employee',
        phone: String(payload.phone ?? ''),
        reference_photo_url: (payload.reference_photo_url as string) ?? null,
        has_face_embedding: true,
        face_embedding_meta: {
          _id: newId('em'),
          user_id: '',
          model_version: 'ArcFace v2',
          created_at: new Date().toISOString(),
          encrypted: true,
        },
        created_at: new Date().toISOString(),
        employee_code: String(payload.employee_code ?? `PNSM-${Date.now().toString().slice(-4)}`),
        department: String(payload.department ?? ''),
        office_id: office?._id ?? data.offices[0]._id,
        is_active: true,
      };
      data.employees.unshift(employee);
      data.users.push(employee);
      const weekLabel = String(payload.days_of_week ?? 'Sun-Thu');
      data.shifts.push({
        _id: newId('s'),
        user_id: employee._id,
        start_time: String(payload.shift_start ?? '09:00'),
        end_time: String(payload.shift_end ?? '18:00'),
        days_of_week: parseWeekLabel(weekLabel),
        days_of_week_label: weekLabel,
      });
      // Person 3 generates the 2FA PIN AND an initial mobile-login password
      // server-side and returns both exactly once (FR-01; DECISIONS.md N9's
      // sibling finding on employeeService.ts's createEmployee).
      return created({
        employee,
        generated_pin: String(Math.floor(1000 + Math.random() * 9000)),
        generated_password: String(Math.floor(10000000 + Math.random() * 90000000)),
      });
    }

    if (second && !third && method === 'GET') {
      const employee = data.employees.find((candidate) => candidate._id === second);
      if (!employee) return fail(404, 'NOT_FOUND', 'That employee record does not exist.');
      const shift = data.shifts.find((candidate) => candidate.user_id === employee._id) ?? null;
      return ok({
        ...employee,
        office_name: officeNameFor(employee.office_id, data.offices),
        shift,
        recent_logs: data.attendance.filter((log) => log.user_id === employee._id).slice(0, 25),
      });
    }

    if (second && !third && method === 'PATCH') {
      const employee = data.employees.find((candidate) => candidate._id === second);
      if (!employee) return fail(404, 'NOT_FOUND', 'That employee record does not exist.');
      Object.assign(employee, payload);
      return ok(employee);
    }

    if (second && third === 'photo' && method === 'PATCH') {
      const employee = data.employees.find((candidate) => candidate._id === second);
      if (!employee) return fail(404, 'NOT_FOUND', 'That employee record does not exist.');
      employee.reference_photo_url = String(payload.reference_photo_url ?? '');
      employee.has_face_embedding = true;
      employee.face_embedding_meta = {
        _id: newId('em'),
        user_id: employee._id,
        model_version: 'ArcFace v2',
        created_at: new Date().toISOString(),
        encrypted: true,
      };
      return ok(employee);
    }

    if (second && !third && method === 'DELETE') {
      const employee = data.employees.find((candidate) => candidate._id === second);
      if (!employee) return fail(404, 'NOT_FOUND', 'That employee record does not exist.');
      employee.is_active = false;
      return ok(employee);
    }
  }

  // ---- offices & geofences ------------------------------------------------
  if (root === 'offices' && method === 'GET') return ok(data.offices);

  if (root === 'geofences') {
    if (method === 'GET') {
      return ok(
        data.geofences.map((fence) => ({
          ...fence,
          office_name: officeNameFor(fence.office_id, data.offices),
        })),
      );
    }
    if (method === 'POST') {
      const office: Office = {
        _id: newId('o'),
        office_name: String(payload.office_name ?? 'New office'),
        address: String(payload.address ?? ''),
      };
      data.offices.push(office);
      const fence: Geofence = {
        _id: newId('g'),
        office_id: office._id,
        office_name: office.office_name,
        location: { type: 'Point', coordinates: [Number(payload.lng), Number(payload.lat)] },
        radius_meters: Number(payload.radius_meters ?? 50),
      };
      data.geofences.push(fence);
      return created(fence);
    }
    if (second && method === 'PATCH') {
      const fence = data.geofences.find((candidate) => candidate._id === second);
      if (!fence) return fail(404, 'NOT_FOUND', 'That geofence does not exist.');
      if (payload.lat !== undefined && payload.lng !== undefined) {
        fence.location = { type: 'Point', coordinates: [Number(payload.lng), Number(payload.lat)] };
      }
      if (payload.radius_meters !== undefined) fence.radius_meters = Number(payload.radius_meters);
      const office = data.offices.find((candidate) => candidate._id === fence.office_id);
      if (office && payload.office_name) office.office_name = String(payload.office_name);
      if (office && payload.address) office.address = String(payload.address);
      return ok(fence);
    }
    if (second && method === 'DELETE') {
      const index = data.geofences.findIndex((candidate) => candidate._id === second);
      if (index === -1) return fail(404, 'NOT_FOUND', 'That geofence does not exist.');
      data.geofences.splice(index, 1);
      return ok({ deleted: true });
    }
  }

  // ---- attendance ---------------------------------------------------------
  if (root === 'attendance') {
    if (!second && method === 'GET') {
      const filtered = filterAttendance(params);
      const result = paginate(filtered, page, pageSize);
      return ok(result.rows, result.meta);
    }
    if (second === 'feed' && method === 'GET') {
      const limit = Number(params.get('limit') ?? 15) || 15;
      return ok(data.attendance.slice(0, limit));
    }
    if (second === 'live-map' && method === 'GET') return ok(liveMapPoints());
    // M2: matches the real { url } shape (attendance.routes.ts's selfie-url
    // handler). Every seeded/generated log has selfie_url: null today, so
    // this never actually fires from demo data — kept for contract parity if
    // that ever changes, same as the rest of this file's fidelity-over-ease
    // convention.
    if (second && third === 'selfie-url' && method === 'GET') {
      const log = data.attendance.find((candidate) => candidate._id === second);
      return ok({ url: log?.selfie_url ? '/reference-placeholder.svg' : null });
    }
    if (second && (third === 'approve' || third === 'reject') && method === 'POST') {
      const log = data.attendance.find((candidate) => candidate._id === second);
      if (!log) return fail(404, 'NOT_FOUND', 'That check-in does not exist.');
      log.status = third === 'approve' ? 'approved' : ('rejected' as AttendanceStatus);
      return ok(log);
    }
  }

  // ---- leave --------------------------------------------------------------
  if (root === 'leave') {
    if (!second && method === 'GET') {
      const status = params.get('status');
      const rows = status && status !== 'all'
        ? data.leave.filter((request) => request.status === status)
        : data.leave;
      return ok(rows);
    }
    if (second && (third === 'approve' || third === 'reject') && method === 'POST') {
      const request = data.leave.find((candidate) => candidate._id === second);
      if (!request) return fail(404, 'NOT_FOUND', 'That leave request does not exist.');
      request.status = third === 'approve' ? 'approved' : ('rejected' as LeaveRequest['status']);
      return ok(request);
    }
  }

  // ---- misc ---------------------------------------------------------------
  if (root === 'notifications' && method === 'GET') return ok(data.notifications);
  if (root === 'shifts' && method === 'GET') return ok(data.shifts);
  if (root === 'audit' && method === 'GET') return ok(data.audit);
  if (root === 'spoof-alerts' && method === 'GET') return ok(data.spoofAlerts);
  if (root === 'admins' && method === 'GET') {
    return ok(data.users.filter((user) => user.role_name !== 'Employee'));
  }
  if (root === 'policy' && method === 'GET') {
    return ok({
      face_match_threshold: FACE_MATCH_THRESHOLD,
      default_radius_meters: 50,
      late_arrival_cutoff: '09:15',
      block_mock_location: true,
    });
  }
  if (root === 'policy' && method === 'PATCH') return ok(payload);
  if (root === 'billing' && method === 'GET') {
    return ok({
      plan: 'Course demo (free tiers)',
      seats: data.employees.length,
      monthly_cost_bdt: 0,
      renewal_date: '2026-09-01',
      components: [
        { name: 'MongoDB Atlas M0', cost: 0, note: '512 MB shared cluster' },
        { name: 'Render / Koyeb free web service', cost: 0, note: 'Spins down after 15 min idle' },
        { name: 'Cloudflare R2', cost: 0, note: 'Zero egress fees' },
        { name: 'Vercel Hobby', cost: 0, note: 'Frontend hosting' },
      ],
    });
  }

  return fail(404, 'NO_ROUTE', `The mock backend has no handler for ${method} /${path}.`);
}

/** Used by the simulated socket to invent a plausible new check-in. */
export function generateLiveCheckIn(): AttendanceLog {
  const data = db();
  const employee = data.employees[Math.floor(Math.random() * data.employees.length)];
  const officeIndex = data.employees.indexOf(employee) % data.geofences.length;
  const fence = data.geofences[officeIndex];
  const score = Math.random() < 0.15
    ? 70 + Math.random() * (FACE_MATCH_THRESHOLD - 70)
    : 86 + Math.random() * 13;
  const log: AttendanceLog = {
    _id: newId('l'),
    user_id: employee._id,
    geofence_id: fence._id,
    check_type: 'check_in',
    timestamp: new Date().toISOString(),
    gps_location: fence.location,
    face_match_score: Number(score.toFixed(1)),
    selfie_url: null,
    status: score >= FACE_MATCH_THRESHOLD ? 'approved' : 'flagged',
    employee_name: employee.name,
    employee_code: employee.employee_code,
    office_name: fence.office_name,
    mock_location_detected: false,
  };
  data.attendance.unshift(log);
  return log;
}
