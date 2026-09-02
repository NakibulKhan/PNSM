/**
 * The check-in pipeline (blueprint FR-05/FR-07) plus admin-facing attendance
 * queries. The check-in sequence follows Person 4's documented order exactly
 * (Person4_AIBiometricService/docs/INTEGRATION.md §2.4-§2.6, API.md's
 * POST /v1/verify section) — see DECISIONS.md N1/N2/N5 for why PIN and face
 * verification live in Person 4's service rather than here.
 */
import { Types } from 'mongoose';
import { AttendanceLog, FaceEmbedding, Geofence, Notification, SpoofAlert, User } from '../models';
import type { MobileAnomalyInput, MobileCheckinInput } from '../validation/mobileSchemas';
import type { ListAttendanceQuery, AttendanceFeedQuery } from '../validation/attendanceSchemas';
import { isInsideGeofence, InvalidCoordinatesError } from './geofenceService';
import { getAiClient, newUlid, PnsmAiError } from './aiClient';
import { emitAttendanceFlagged, emitAttendanceNew, emitNotificationNew, emitSpoofAlert } from './socket/emitters';
import { MobileApiError, AdminApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { todayDhakaRangeUtc } from '../utils/tz';
import type { AttendanceStatus } from '../constants';

export interface CheckinSuccess {
  kind: 'success';
  status: 'approved' | 'flagged';
  attendance_log_id: string;
  face_match_score: number;
  reason: string | null;
  server_timestamp: string;
}

/**
 * Codes from Person 4's reason-code table (API.md) mapped onto the reason
 * vocabulary Person 1's `interpretCheckinResponse` (checkinService.js)
 * already has dedicated copy for. Anything not in this table falls back to
 * the lowercased Person 4 code, which still renders correctly via that
 * function's generic default branch — just without bespoke wording yet.
 * Extending this table is a Phase 3 follow-up as Person 1 adds more cases.
 */
const REASON_CODE_MAP: Record<string, string> = {
  MOCK_LOCATION: 'mock_location_detected',
  NO_MATCH: 'low_face_match',
};

function lowerReason(code: string): string {
  return REASON_CODE_MAP[code] ?? code.toLowerCase();
}

/**
 * Runs the full six-step check-in sequence. Throws MobileApiError for every
 * rejection path — the route handler's asyncHandler + central error middleware
 * format it — and returns CheckinSuccess only when an AttendanceLog was
 * actually written.
 */
export async function performCheckin(userId: string, input: MobileCheckinInput): Promise<CheckinSuccess> {
  // Cheapest local check first: a client that already knows liveness failed
  // should never reach the PIN check or the AI service at all.
  if (input.liveness_passed === false) {
    throw new MobileApiError(422, 'liveness_failed');
  }

  // --- Step 2: PIN verify (Person 4) ---------------------------------------
  const user = await User.findById(userId).select('+pin_hash +pin_algo +pin_cost +pin_pepper_version');
  if (!user || !user.is_active) {
    throw new MobileApiError(401, 'unauthenticated');
  }
  if (!user.pin_hash) {
    // Onboarding gap, not a PIN the employee got wrong — distinct reason so
    // it routes to "contact HR" messaging rather than "try again".
    throw new MobileApiError(409, 'pin_not_set');
  }

  const ai = getAiClient();
  try {
    const pinResult = await ai.verifyPin(userId, input.pin, user.pin_hash);
    if (!pinResult.match) {
      throw new MobileApiError(401, 'pin_mismatch', {
        attempts_left: pinResult.attempts_left,
        locked: pinResult.locked,
      });
    }
  } catch (err) {
    if (err instanceof MobileApiError) throw err;
    if (err instanceof PnsmAiError) {
      if (err.code === 'RATE_LIMITED') {
        throw new MobileApiError(429, 'pin_locked');
      }
      logger.error('AI service PIN verify failed', err, { userId });
      throw new MobileApiError(err.retryable ? 502 : err.status || 500, 'server_error');
    }
    throw err;
  }

  // --- Step 3: geofence query (Person 3) -----------------------------------
  let geofenceCheck;
  try {
    geofenceCheck = await isInsideGeofence(input.geofence_id, input.gps);
  } catch (err) {
    if (err instanceof InvalidCoordinatesError) {
      throw new MobileApiError(422, 'invalid_location');
    }
    throw err;
  }
  if (!geofenceCheck.inside) {
    throw new MobileApiError(422, 'outside_geofence', { distance_meters: geofenceCheck.distance_meters });
  }

  // --- Step 4: face verify (Person 4) --------------------------------------
  const embedding = await FaceEmbedding.findOne({ user_id: userId }).select('+envelope');
  if (!embedding) {
    throw new MobileApiError(409, 'no_reference_embedding');
  }

  const requestId = input.request_id ?? newUlid();
  let result;
  try {
    result = await ai.verify({
      userRef: userId,
      image: { kind: 's3_key', value: input.object_key },
      envelope: embedding.envelope as Record<string, unknown>,
      requestId,
      capturedAt: input.captured_at,
      device: {
        platform: input.device.platform,
        osVersion: input.device.os_version,
        appVersion: input.device.app_version,
        isMockLocation: input.device.is_mock_location,
        isEmulator: input.device.is_emulator,
        isRooted: input.device.is_rooted,
      },
    });
  } catch (err) {
    throw await handleVerifyError(err, userId, input);
  }

  if (result.decision === 'rejected') {
    // No AttendanceLog — the employee retries (Person4_AIBiometricService/docs/INTEGRATION.md §2.5).
    throw new MobileApiError(200, lowerReason(result.reason_code), { face_match_score: result.confidence });
  }

  // --- Step 5: write the AttendanceLog (Person 3) --------------------------
  const status: AttendanceStatus = result.decision; // 'approved' | 'flagged'
  const now = new Date();
  const log = await AttendanceLog.create({
    user_id: new Types.ObjectId(userId),
    geofence_id: new Types.ObjectId(input.geofence_id),
    check_type: input.check_type,
    timestamp: new Date(input.timestamp),
    server_timestamp: now,
    gps_location: { type: 'Point', coordinates: [input.gps.lng, input.gps.lat] },
    mock_location_detected: input.device.is_mock_location,
    liveness_passed: input.liveness_passed,
    face_match_score: result.confidence,
    // Bucket blocks public access — this is an object key, not a browsable
    // URL. Admin viewing goes through a presign-get proxy (DECISIONS.md N2).
    selfie_url: input.object_key,
    status,
  });

  // --- Step 6: broadcast (Person 3) ----------------------------------------
  const populated = await AttendanceLog.findById(log._id)
    .populate<{ user_id: { name: string; employee_code?: string } }>('user_id', 'name employee_code')
    .lean();
  const payload = toAttendanceLogSocketPayload(populated);
  emitAttendanceNew(payload);
  if (status === 'flagged') {
    emitAttendanceFlagged(payload);
    const notification = await Notification.create({
      recipient_id: null, // broadcast-style HR notification; no single recipient scoping in this phase
      log_id: log._id,
      message: `Check-in for ${populated?.user_id?.name ?? 'an employee'} flagged for review (${result.confidence}% match).`,
    }).catch(() => null);
    if (notification) {
      emitNotificationNew({ _id: String(notification._id), message: notification.message, created_at: notification.created_at });
    }
  }

  return {
    kind: 'success',
    status,
    attendance_log_id: String(log._id),
    face_match_score: result.confidence,
    reason: status === 'flagged' ? 'low_face_match' : null,
    server_timestamp: now.toISOString(),
  };
}

/**
 * Person4_AIBiometricService/docs/INTEGRATION.md §2.6's documented error
 * switch, ported faithfully. Security-event codes raise a SpoofAlert and the
 * spoof:alert broadcast so HR sees it live.
 */
async function handleVerifyError(err: unknown, userId: string, input: MobileCheckinInput): Promise<MobileApiError> {
  if (!(err instanceof PnsmAiError)) {
    logger.error('Unexpected error calling AI service verify', err, { userId });
    return new MobileApiError(502, 'server_error');
  }

  switch (err.code) {
    case 'MOCK_LOCATION':
    case 'EMULATOR_DETECTED': {
      const alert = await SpoofAlert.create({
        user_id: new Types.ObjectId(userId),
        reason: err.code,
        gps_location: { type: 'Point', coordinates: [input.gps.lng, input.gps.lat] },
      });
      const populated = await SpoofAlert.findById(alert._id).populate<{ user_id: { name: string } }>('user_id', 'name').lean();
      emitSpoofAlert({
        _id: String(alert._id),
        employee_name: populated?.user_id?.name ?? 'Unknown',
        detected_at: alert.detected_at,
        reason: alert.reason,
      });
      return new MobileApiError(403, lowerReason(err.code));
    }

    case 'REPLAY_DETECTED':
    case 'STALE_CAPTURE':
      return new MobileApiError(409, lowerReason(err.code));

    case 'MODEL_VERSION_MISMATCH':
    case 'NO_REFERENCE_EMBEDDING':
      return new MobileApiError(409, 'profile_needs_attention');

    case 'DECRYPT_FAILED':
      logger.error('AI service reported DECRYPT_FAILED — treat as a security event', err, { userId });
      return new MobileApiError(500, 'server_error');

    default:
      logger.error('AI service verify failed', err, { userId, code: err.code, retryable: err.retryable });
      return new MobileApiError(err.retryable ? 502 : err.status || 500, 'server_error');
  }
}

/**
 * POST /api/mobile/attendance/anomaly — the client rejects a spoofed check-in
 * locally (to preserve server bandwidth, per the blueprint) but still reports
 * the attempt for HR review. Fire-and-forget from the client's perspective;
 * this always succeeds if the write does, regardless of any other pipeline
 * state.
 */
export async function reportMobileAnomaly(userId: string, input: MobileAnomalyInput) {
  const alert = await SpoofAlert.create({
    user_id: new Types.ObjectId(userId),
    detected_at: new Date(input.timestamp),
    reason: 'mock_location_detected',
    gps_location: { type: 'Point', coordinates: [input.lng, input.lat] },
  });
  const populated = await SpoofAlert.findById(alert._id).populate<{ user_id: { name: string } }>('user_id', 'name').lean();
  emitSpoofAlert({
    _id: String(alert._id),
    employee_name: populated?.user_id?.name ?? 'Unknown',
    detected_at: alert.detected_at,
    reason: alert.reason,
  });
}

/* ============================================================ admin reads */

interface AttendanceListFilter {
  user_id?: Types.ObjectId;
  status?: string;
  timestamp?: { $gte?: Date; $lte?: Date };
  geofence_id?: { $in: Types.ObjectId[] };
}

async function officeGeofenceIds(officeId: string): Promise<Types.ObjectId[]> {
  const zones = await Geofence.find({ office_id: officeId }).select('_id').lean();
  return zones.map((z) => z._id);
}

function toAttendanceLogSocketPayload(doc: Record<string, unknown> | null): Record<string, unknown> {
  if (!doc) return {};
  const user = doc.user_id as { name?: string; employee_code?: string; _id?: unknown } | undefined;
  return {
    ...doc,
    _id: String(doc._id),
    user_id: user && typeof user === 'object' && 'name' in user ? String((user as { _id: unknown })._id) : String(doc.user_id),
    employee_name: user?.name,
    employee_code: user?.employee_code,
  };
}

export async function listAttendance(query: ListAttendanceQuery) {
  const filter: AttendanceListFilter = {};
  if (query.employeeId) filter.user_id = new Types.ObjectId(query.employeeId);
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.timestamp = {};
    if (query.from) filter.timestamp.$gte = new Date(query.from);
    if (query.to) filter.timestamp.$lte = new Date(query.to);
  }
  if (query.officeId) {
    filter.geofence_id = { $in: await officeGeofenceIds(query.officeId) };
  }

  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    AttendanceLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(query.pageSize)
      .populate('user_id', 'name employee_code')
      .populate({ path: 'geofence_id', populate: { path: 'office_id', select: 'office_name' } })
      .lean(),
    AttendanceLog.countDocuments(filter),
  ]);

  const search = query.search?.trim().toLowerCase();
  const filtered = search
    ? rows.filter((row) => {
        const user = row.user_id as unknown as { name?: string; employee_code?: string } | null;
        return (
          user?.name?.toLowerCase().includes(search) || user?.employee_code?.toLowerCase().includes(search)
        );
      })
    : rows;

  return { rows: filtered.map(toAttendanceRowDTO), total, page: query.page, pageSize: query.pageSize };
}

export async function getFeed(query: AttendanceFeedQuery) {
  const rows = await AttendanceLog.find({})
    .sort({ timestamp: -1 })
    .limit(query.limit)
    .populate('user_id', 'name employee_code')
    .populate({ path: 'geofence_id', populate: { path: 'office_id', select: 'office_name' } })
    .lean();
  return rows.map(toAttendanceRowDTO);
}

/** Employees whose latest event today is a check-in (still on-site, per the live map). */
export async function getLiveMap() {
  const range = todayDhakaRangeUtc();
  const rows = await AttendanceLog.aggregate([
    { $match: { timestamp: { $gte: range.from, $lte: range.to } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$user_id', latest: { $first: '$$ROOT' } } },
    { $match: { 'latest.check_type': 'check_in' } },
    { $replaceRoot: { newRoot: '$latest' } },
  ]);
  const populated = await AttendanceLog.populate(rows, [
    { path: 'user_id', select: 'name employee_code' },
    { path: 'geofence_id', populate: { path: 'office_id', select: 'office_name' } },
  ]);
  // aggregate() + populate() on plain objects returns a Mongoose Document
  // type by inference even though these are POJOs at runtime (no index
  // signature, which toAttendanceRowDTO's loose mapper relies on) — the same
  // shape .lean() results have everywhere else in this file.
  return (populated as unknown as Record<string, unknown>[]).map(toAttendanceRowDTO);
}

function toAttendanceRowDTO(row: Record<string, unknown>) {
  const user = row.user_id as { _id?: unknown; name?: string; employee_code?: string } | null;
  const geofence = row.geofence_id as { _id?: unknown; office_id?: { office_name?: string } } | null;
  return {
    _id: String(row._id),
    user_id: user?._id ? String(user._id) : null,
    geofence_id: geofence?._id ? String(geofence._id) : null,
    check_type: row.check_type,
    timestamp: (row.timestamp as Date)?.toISOString?.() ?? row.timestamp,
    server_timestamp: (row.server_timestamp as Date)?.toISOString?.() ?? row.server_timestamp,
    gps_location: row.gps_location,
    mock_location_detected: row.mock_location_detected,
    liveness_passed: row.liveness_passed,
    face_match_score: row.face_match_score,
    selfie_url: row.selfie_url,
    status: row.status,
    employee_name: user?.name ?? null,
    employee_code: user?.employee_code ?? null,
    office_name: geofence?.office_id?.office_name ?? null,
  };
}

async function setAttendanceStatus(id: string, status: 'approved' | 'rejected') {
  const log = await AttendanceLog.findByIdAndUpdate(id, { status }, { new: true })
    .populate('user_id', 'name employee_code')
    .populate({ path: 'geofence_id', populate: { path: 'office_id', select: 'office_name' } })
    .lean();
  if (!log) throw new AdminApiError(404, 'NOT_FOUND', 'Attendance record not found.');
  const dto = toAttendanceRowDTO(log);
  emitAttendanceNew(dto);
  return dto;
}

export const approveAttendance = (id: string) => setAttendanceStatus(id, 'approved');
export const rejectAttendance = (id: string) => setAttendanceStatus(id, 'rejected');
