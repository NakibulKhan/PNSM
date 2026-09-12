/**
 * Deterministic seed data for demo mode.
 *
 * WHY DETERMINISTIC: a seeded PRNG means the dataset is identical on every
 * server start, so screenshots, tests and the demo script all stay valid.
 * Randomness here would also risk server/client divergence.
 *
 * All names, offices and coordinates are realistic for Dhaka so the map,
 * geofences and reports look credible in the viva.
 */
import type {
  AttendanceLog,
  AuditLogEntry,
  Geofence,
  LeaveRequest,
  Notification,
  Office,
  Shift,
  SpoofAlert,
  User,
} from '@/types/models';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import { dhakaDayStartUtc, lastNDhakaDateKeys } from '@/lib/tz';

/** mulberry32 — small, fast, fully deterministic. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260725);

const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const between = (min: number, max: number): number => min + rng() * (max - min);
const intBetween = (min: number, max: number): number => Math.floor(between(min, max + 1));

/** Stable 24-char hex ids so they look like real ObjectIds. */
function makeId(prefix: string, index: number): string {
  const base = `${prefix}${index}`;
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return (hash.toString(16) + '0'.repeat(24)).slice(0, 24);
}

// ------------------------------------------------------------------ roles ---
export const ROLE_IDS = {
  superAdmin: makeId('role', 1),
  admin: makeId('role', 2),
  employee: makeId('role', 3),
};

// ---------------------------------------------------------------- offices ---
const OFFICE_SEED = [
  { name: 'Gulshan Office', address: 'Plot 12, Road 103, Gulshan-2, Dhaka 1212', lat: 23.7925, lng: 90.4152, radius: 80 },
  { name: 'Banani Office', address: 'House 44, Road 11, Banani, Dhaka 1213', lat: 23.7937, lng: 90.4003, radius: 60 },
  { name: 'Dhanmondi Office', address: 'House 8, Road 27, Dhanmondi, Dhaka 1209', lat: 23.7461, lng: 90.3742, radius: 50 },
  { name: 'Keraniganj Depot', address: 'Zinzira, Keraniganj, Dhaka 1310', lat: 23.7009, lng: 90.3861, radius: 150 },
];

export const offices: Office[] = OFFICE_SEED.map((office, index) => ({
  _id: makeId('office', index + 1),
  office_name: office.name,
  address: office.address,
}));

export const geofences: Geofence[] = OFFICE_SEED.map((office, index) => ({
  _id: makeId('geofence', index + 1),
  office_id: offices[index]._id,
  office_name: office.name,
  location: { type: 'Point', coordinates: [office.lng, office.lat] },
  radius_meters: office.radius,
}));

// -------------------------------------------------------------- employees ---
const FIRST_NAMES = [
  'Rafiq', 'Nusrat', 'Tanvir', 'Sumaiya', 'Arif', 'Farzana', 'Imran', 'Sadia',
  'Mahmud', 'Tasnim', 'Shakib', 'Nabila', 'Rakib', 'Ishrat', 'Sabbir', 'Mou',
  'Jubayer', 'Anika', 'Hasib', 'Rumana', 'Fahim', 'Priya', 'Naim', 'Lamia',
];
const LAST_NAMES = [
  'Hasan', 'Jahan', 'Alam', 'Akter', 'Rahman', 'Chowdhury', 'Islam', 'Khan',
  'Sarker', 'Haque', 'Mahmud', 'Siddique',
];
const DEPARTMENTS = ['Engineering', 'Human Resources', 'Finance', 'Field Operations', 'Customer Support', 'Logistics'];

const EMPLOYEE_COUNT = 24;

export const users: User[] = [];

/** Two admin accounts that can sign in to this portal. */
users.push({
  _id: makeId('user', 1),
  name: 'Syeda Sanjida Malik',
  email: 'hr@pnsm.test',
  role_id: ROLE_IDS.admin,
  role_name: 'Admin',
  phone: '01712000001',
  reference_photo_url: null,
  has_face_embedding: false,
  created_at: new Date('2026-06-01T04:00:00.000Z').toISOString(),
  employee_code: 'PNSM-0001',
  department: 'Human Resources',
  office_id: offices[0]._id,
  is_active: true,
});
users.push({
  _id: makeId('user', 2),
  name: 'Md. Nakibul Islam Khan',
  email: 'super@pnsm.test',
  role_id: ROLE_IDS.superAdmin,
  role_name: 'Super Admin',
  phone: '01712000002',
  reference_photo_url: null,
  has_face_embedding: false,
  created_at: new Date('2026-06-01T04:00:00.000Z').toISOString(),
  employee_code: 'PNSM-0002',
  department: 'Executive',
  office_id: offices[0]._id,
  is_active: true,
});

for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = pick(LAST_NAMES);
  const office = offices[i % offices.length];
  users.push({
    _id: makeId('user', i + 3),
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@pnsm.test`,
    role_id: ROLE_IDS.employee,
    role_name: 'Employee',
    phone: `017${String(intBetween(10000000, 99999999))}`,
    reference_photo_url: null,
    /*
     * The vector itself lives in the isolated, CSFLE-encrypted FaceEmbeddings
     * collection and is never sent to this console. Only the flag and the
     * non-sensitive metadata cross the wire.
     */
    has_face_embedding: true,
    face_embedding_meta: {
      _id: makeId('embed', i + 3),
      user_id: makeId('user', i + 3),
      model_version: 'ArcFace v2',
      created_at: new Date('2026-06-15T05:00:00.000Z').toISOString(),
      encrypted: true,
    },
    created_at: new Date(2026, 5, 15 + (i % 10), 10).toISOString(),
    employee_code: `PNSM-${String(i + 100).padStart(4, '0')}`,
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    office_id: office._id,
    is_active: i % 17 !== 0,
  });
}

export const employees = users.filter((user) => user.role_name === 'Employee');

// ------------------------------------------------------------------ shifts --
export const shifts: Shift[] = employees.map((employee, index) => ({
  _id: makeId('shift', index + 1),
  user_id: employee._id,
  start_time: index % 5 === 0 ? '10:00' : '09:00',
  end_time: index % 5 === 0 ? '19:00' : '18:00',
  // 0=Sun..6=Sat (ADR-3), matching the real Shift model; days_of_week_label
  // is the server-derived display string. Both used to be a single string
  // field here, which is what M3's fix in types/models.ts caught.
  days_of_week: [0, 1, 2, 3, 4],
  days_of_week_label: 'Sun-Thu',
}));

// ------------------------------------------------------------- attendance ---
function jitterPoint(lat: number, lng: number, meters: number): [number, number] {
  const dLat = (between(-meters, meters) / 111_320);
  const dLng = (between(-meters, meters) / (111_320 * Math.cos((lat * Math.PI) / 180)));
  return [lng + dLng, lat + dLat];
}

function buildAttendance(now: Date): AttendanceLog[] {
  const logs: AttendanceLog[] = [];
  const dateKeys = lastNDhakaDateKeys(7, now);
  let counter = 0;

  dateKeys.forEach((dateKey, dayIndex) => {
    const dayStart = dhakaDayStartUtc(dateKey).getTime();
    employees.forEach((employee, employeeIndex) => {
      // ~88% attendance, deterministic per employee/day.
      if ((employeeIndex * 7 + dayIndex) % 8 === 3) return;

      const officeIndex = employeeIndex % offices.length;
      const seedOffice = OFFICE_SEED[officeIndex];
      const geofence = geofences[officeIndex];

      const checkInOffsetMs =
        (8 * 60 + 40 + intBetween(0, 70)) * 60_000; // 08:40 - 09:50 Dhaka
      const checkInAt = Math.min(dayStart + checkInOffsetMs, now.getTime() - 60_000);

      const score = rng() < 0.12 ? between(68, FACE_MATCH_THRESHOLD - 0.5) : between(86, 99.4);
      const isFlagged = score < FACE_MATCH_THRESHOLD;
      const isRejected = isFlagged && rng() < 0.25;

      counter += 1;
      logs.push({
        _id: makeId('log', counter),
        user_id: employee._id,
        geofence_id: geofence._id,
        check_type: 'check_in',
        timestamp: new Date(checkInAt).toISOString(),
        gps_location: { type: 'Point', coordinates: jitterPoint(seedOffice.lat, seedOffice.lng, 35) },
        face_match_score: Number(score.toFixed(1)),
        selfie_url: null,
        status: isRejected ? 'rejected' : isFlagged ? 'flagged' : 'approved',
        employee_name: employee.name,
        employee_code: employee.employee_code,
        office_name: seedOffice.name,
        mock_location_detected: false,
      });

      // Check-out only for past days, so "today" reads as still in progress.
      if (dayIndex < dateKeys.length - 1) {
        const checkOutAt = dayStart + (18 * 60 + intBetween(0, 55)) * 60_000;
        if (checkOutAt < now.getTime()) {
          counter += 1;
          logs.push({
            _id: makeId('log', counter),
            user_id: employee._id,
            geofence_id: geofence._id,
            check_type: 'check_out',
            timestamp: new Date(checkOutAt).toISOString(),
            gps_location: { type: 'Point', coordinates: jitterPoint(seedOffice.lat, seedOffice.lng, 35) },
            face_match_score: Number(between(88, 99).toFixed(1)),
            selfie_url: null,
            status: 'approved',
            employee_name: employee.name,
            employee_code: employee.employee_code,
            office_name: seedOffice.name,
            mock_location_detected: false,
          });
        }
      }
    });
  });

  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ------------------------------------------------------------------ leave ---
function buildLeave(now: Date): LeaveRequest[] {
  return employees.slice(0, 9).map((employee, index) => {
    const start = new Date(now.getTime() + (index - 3) * 86_400_000);
    const end = new Date(start.getTime() + intBetween(0, 3) * 86_400_000);
    const status: LeaveRequest['status'] = index < 4 ? 'pending' : index < 7 ? 'approved' : 'rejected';
    return {
      _id: makeId('leave', index + 1),
      user_id: employee._id,
      employee_name: employee.name,
      from_date: start.toISOString(),
      to_date: end.toISOString(),
      reason: pick(['Family emergency', 'Medical appointment', 'Annual leave', 'Wedding in the family', 'Sick leave']),
      status,
      created_at: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString(),
    };
  });
}

// ---------------------------------------------------- notifications / audit --
function buildNotifications(now: Date, logs: AttendanceLog[]): Notification[] {
  return logs.slice(0, 12).map((log, index) => ({
    _id: makeId('notif', index + 1),
    recipient_id: users[0]._id,
    log_id: log._id,
    message: `${log.employee_name} checked in at ${log.office_name}`,
    is_read: index > 4,
    created_at: new Date(now.getTime() - index * 900_000).toISOString(),
  }));
}

function buildAudit(now: Date): AuditLogEntry[] {
  const actions = [
    ['Created employee profile', 'PNSM-0113'],
    ['Updated geofence radius', 'Gulshan Office'],
    ['Approved flagged check-in', 'LOG-0421'],
    ['Exported monthly report', 'July 2026'],
    ['Deactivated account', 'PNSM-0107'],
    ['Changed face-match threshold', '85% → 85%'],
    ['Approved leave request', 'Sadia Akter'],
    ['Added office location', 'Keraniganj Depot'],
  ] as const;
  return actions.map(([action, target], index) => ({
    _id: makeId('audit', index + 1),
    actor_id: users[index % 2]._id,
    actor_name: users[index % 2].name,
    action,
    target,
    created_at: new Date(now.getTime() - (index + 1) * 5_400_000).toISOString(),
  }));
}

function buildSpoofAlerts(now: Date): SpoofAlert[] {
  return employees.slice(4, 7).map((employee, index) => ({
    _id: makeId('spoof', index + 1),
    user_id: employee._id,
    employee_name: employee.name,
    detected_at: new Date(now.getTime() - (index + 1) * 7_200_000).toISOString(),
    reason: index === 0 ? 'Mock location provider active (Android)' : 'Simulated location reported (iOS)',
    gps_location: { type: 'Point', coordinates: [90.36 + index * 0.01, 23.81 + index * 0.01] },
  }));
}

export function buildSeed(now: Date = new Date()) {
  const attendance = buildAttendance(now);
  return {
    // `offices`/`geofences`/`users`/`employees`/`shifts` are module-level
    // singletons (computed once at import time from the deterministic rng,
    // unlike `attendance`/`leave`/etc. below, which are freshly generated on
    // every call). The mock API's write handlers mutate them in place
    // (e.g. `data.offices.push(...)` on POST /geofences) — returned directly,
    // that mutation would permanently leak into every later `resetMockStore()`
    // call for the rest of the process, since "reset" would keep re-wrapping
    // the same already-mutated arrays. Cloned here so every build is a
    // genuinely independent snapshot. First real `npm test` run for this
    // project (never executed before) caught this: a test that creates a
    // geofence made every later attendance-related test in the same file
    // throw, because the singleton `offices` array had grown to 5 entries
    // while `OFFICE_SEED` (used for lat/lng lookups) stayed at 4.
    offices: structuredClone(offices),
    geofences: structuredClone(geofences),
    users: structuredClone(users),
    employees: structuredClone(employees),
    shifts: structuredClone(shifts),
    attendance,
    leave: buildLeave(now),
    notifications: buildNotifications(now, attendance),
    audit: buildAudit(now),
    spoofAlerts: buildSpoofAlerts(now),
  };
}

export type SeedData = ReturnType<typeof buildSeed>;
