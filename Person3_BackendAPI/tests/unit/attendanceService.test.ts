/**
 * Unit tests for the check-in pipeline (DECISIONS.md N1/N2/N5). Mocks the
 * persistence layer and Person 4's AI client entirely — same scope choice as
 * tests/integration/auth.test.ts: no live MongoDB or AI service is used.
 * jest.mock() sits above the imports for the same ts-jest hoisting reason
 * documented there.
 */
jest.mock('@/models', () => ({
  User: { findById: jest.fn() },
  FaceEmbedding: { findOne: jest.fn() },
  AttendanceLog: { create: jest.fn(), findById: jest.fn() },
  SpoofAlert: { create: jest.fn(), findById: jest.fn() },
  Notification: { create: jest.fn() },
  Geofence: { find: jest.fn() },
}));

jest.mock('@/services/aiClient', () => {
  const actual = jest.requireActual('@/services/aiClient');
  return { ...actual, getAiClient: jest.fn() };
});

jest.mock('@/services/geofenceService', () => {
  const actual = jest.requireActual('@/services/geofenceService');
  return { ...actual, isInsideGeofence: jest.fn() };
});

jest.mock('@/services/socket/emitters', () => ({
  emitAttendanceNew: jest.fn(),
  emitAttendanceFlagged: jest.fn(),
  emitSpoofAlert: jest.fn(),
  emitNotificationNew: jest.fn(),
}));

import { AttendanceLog, FaceEmbedding, Notification, SpoofAlert, User } from '@/models';
import { getAiClient, PnsmAiError } from '@/services/aiClient';
import { isInsideGeofence } from '@/services/geofenceService';
import { emitAttendanceFlagged, emitAttendanceNew, emitSpoofAlert } from '@/services/socket/emitters';
import { performCheckin } from '@/services/attendanceService';
import { MobileApiError } from '@/utils/errors';
import type { MobileCheckinInput } from '@/validation/mobileSchemas';

const mockedUser = User as unknown as { findById: jest.Mock };
const mockedFaceEmbedding = FaceEmbedding as unknown as { findOne: jest.Mock };
const mockedAttendanceLog = AttendanceLog as unknown as { create: jest.Mock; findById: jest.Mock };
const mockedSpoofAlert = SpoofAlert as unknown as { create: jest.Mock; findById: jest.Mock };
const mockedNotification = Notification as unknown as { create: jest.Mock };
const mockedGetAiClient = getAiClient as jest.Mock;
const mockedIsInsideGeofence = isInsideGeofence as jest.Mock;

const BASE_INPUT: MobileCheckinInput = {
  check_type: 'check_in',
  timestamp: '2026-09-14T09:02:41.000Z',
  captured_at: '2026-09-14T09:02:41.000Z',
  gps: { lat: 23.8151, lng: 90.4257 },
  geofence_id: '507f1f77bcf86cd799439012',
  pin: '4821',
  liveness_passed: true,
  object_key: 'checkins/2026/09/14/u1/01JB80.webp',
  device: {
    platform: 'android',
    os_version: '14',
    app_version: '1.0.0',
    is_mock_location: false,
    is_emulator: false,
    is_rooted: false,
  },
};

function mockAiClient(overrides: { verifyPin?: jest.Mock; verify?: jest.Mock } = {}) {
  const client = {
    verifyPin: overrides.verifyPin ?? jest.fn().mockResolvedValue({ match: true, locked: false, attempts_left: 5, retry_after_s: 0 }),
    verify:
      overrides.verify ??
      jest.fn().mockResolvedValue({
        decision: 'approved',
        confidence: 91.4,
        raw_cosine: 0.62,
        threshold: { approve: 85, bands: 'two', calibration_version: 'cal-1', approve_at_cosine: 0.51 },
        reason_code: 'OK_MATCH',
        hr_alert: false,
        quality: {},
        model_version: 'v1',
        image_hash: 'hash',
        capture_skew_s: 1,
        latency_ms: {},
      }),
  };
  mockedGetAiClient.mockReturnValue(client);
  return client;
}

function mockHappyPathDeps() {
  mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
  mockedIsInsideGeofence.mockResolvedValue({ inside: true, geofence_id: 'g1', distance_meters: 4 });
  mockedFaceEmbedding.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ envelope: { v: 2 } }) });
  mockedAttendanceLog.create.mockResolvedValue({ _id: 'log1' });
  mockedAttendanceLog.findById.mockReturnValue({
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue({ _id: 'log1', user_id: { name: 'Rafiq', employee_code: 'PNSM-01' } }),
  });
  mockedNotification.create.mockResolvedValue({ _id: 'n1', message: 'msg', created_at: new Date() });
}

describe('performCheckin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('approves a check-in and writes an AttendanceLog when everything passes', async () => {
    mockHappyPathDeps();
    mockAiClient();

    const result = await performCheckin('507f1f77bcf86cd799439011', BASE_INPUT);

    expect(result.status).toBe('approved');
    expect(result.attendance_log_id).toBe('log1');
    expect(result.face_match_score).toBe(91.4);
    expect(result.reason).toBeNull();
    expect(mockedAttendanceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', selfie_url: BASE_INPUT.object_key }),
    );
    expect(emitAttendanceNew).toHaveBeenCalledTimes(1);
    expect(emitAttendanceFlagged).not.toHaveBeenCalled();
  });

  it('flags a check-in, still writes the log, and raises a notification', async () => {
    mockHappyPathDeps();
    mockAiClient({
      verify: jest.fn().mockResolvedValue({
        decision: 'flagged',
        confidence: 70,
        raw_cosine: 0.45,
        threshold: { approve: 85, flag: 60, bands: 'three', calibration_version: 'cal-1', approve_at_cosine: 0.51, flag_at_cosine: 0.44 },
        reason_code: 'LOW_CONFIDENCE',
        hr_alert: true,
        quality: {},
        model_version: 'v1',
        image_hash: 'hash',
        capture_skew_s: 1,
        latency_ms: {},
      }),
    });

    const result = await performCheckin('507f1f77bcf86cd799439011', BASE_INPUT);

    expect(result.status).toBe('flagged');
    expect(result.reason).toBe('low_face_match');
    expect(emitAttendanceFlagged).toHaveBeenCalledTimes(1);
    expect(mockedNotification.create).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately on liveness_passed:false without touching the DB or AI service', async () => {
    await expect(performCheckin('507f1f77bcf86cd799439011', { ...BASE_INPUT, liveness_passed: false })).rejects.toMatchObject({
      statusCode: 422,
      reason: 'liveness_failed',
    });
    expect(mockedUser.findById).not.toHaveBeenCalled();
    expect(mockedGetAiClient).not.toHaveBeenCalled();
  });

  it('rejects with 401 pin_mismatch when the AI service reports no match', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
    mockAiClient({ verifyPin: jest.fn().mockResolvedValue({ match: false, locked: false, attempts_left: 3, retry_after_s: 0 }) });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({ statusCode: 401, reason: 'pin_mismatch' });
    expect(mockedIsInsideGeofence).not.toHaveBeenCalled();
  });

  it('rejects with 429 pin_locked when the AI service reports the PIN budget is spent', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
    mockAiClient({ verifyPin: jest.fn().mockRejectedValue(new PnsmAiError(429, { error: { code: 'RATE_LIMITED', message: 'locked' } })) });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({ statusCode: 429, reason: 'pin_locked' });
  });

  it('rejects with 409 pin_not_set when the employee has no PIN hash yet', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: undefined }) });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({ statusCode: 409, reason: 'pin_not_set' });
    expect(mockedGetAiClient).not.toHaveBeenCalled();
  });

  it('rejects with 422 outside_geofence when the geofence check fails, before calling the AI verify step', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
    const client = mockAiClient();
    mockedIsInsideGeofence.mockResolvedValue({ inside: false, geofence_id: 'g1', distance_meters: 250 });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({
      statusCode: 422,
      reason: 'outside_geofence',
      extra: { distance_meters: 250 },
    });
    expect(client.verify).not.toHaveBeenCalled();
  });

  it('rejects with 409 no_reference_embedding when the employee has never enrolled a face', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
    mockedIsInsideGeofence.mockResolvedValue({ inside: true, geofence_id: 'g1', distance_meters: 4 });
    mockedFaceEmbedding.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const client = mockAiClient();

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({ statusCode: 409, reason: 'no_reference_embedding' });
    expect(client.verify).not.toHaveBeenCalled();
  });

  it('raises a SpoofAlert and rejects with 403 when the AI service reports MOCK_LOCATION', async () => {
    mockedUser.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ is_active: true, pin_hash: 'hashed' }) });
    mockedIsInsideGeofence.mockResolvedValue({ inside: true, geofence_id: 'g1', distance_meters: 4 });
    mockedFaceEmbedding.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ envelope: { v: 2 } }) });
    mockedSpoofAlert.create.mockResolvedValue({ _id: 'sa1', reason: 'MOCK_LOCATION', detected_at: new Date() });
    mockedSpoofAlert.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'sa1', user_id: { name: 'Rafiq' }, reason: 'MOCK_LOCATION', detected_at: new Date() }),
    });
    mockAiClient({
      verify: jest.fn().mockRejectedValue(new PnsmAiError(403, { error: { code: 'MOCK_LOCATION', message: 'blocked' } })),
    });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({ statusCode: 403, reason: 'mock_location_detected' });
    expect(mockedSpoofAlert.create).toHaveBeenCalledTimes(1);
    expect(emitSpoofAlert).toHaveBeenCalledTimes(1);
  });

  it('rejects with 200/rejected and passes the face_match_score through when the AI service reports NO_MATCH', async () => {
    mockHappyPathDeps();
    mockAiClient({
      verify: jest.fn().mockResolvedValue({
        decision: 'rejected',
        confidence: 22,
        raw_cosine: 0.1,
        threshold: { approve: 85, bands: 'two', calibration_version: 'cal-1', approve_at_cosine: 0.51 },
        reason_code: 'NO_MATCH',
        hr_alert: true,
        quality: {},
        model_version: 'v1',
        image_hash: 'hash',
        capture_skew_s: 1,
        latency_ms: {},
      }),
    });

    await expect(performCheckin('507f1f77bcf86cd799439011', BASE_INPUT)).rejects.toMatchObject({
      statusCode: 200,
      reason: 'low_face_match',
      extra: { face_match_score: 22 },
    });
    expect(mockedAttendanceLog.create).not.toHaveBeenCalled();
  });
});

describe('MobileApiError shape sanity (used by the .rejects.toMatchObject assertions above)', () => {
  it('carries statusCode/reason/extra as plain properties', () => {
    const err = new MobileApiError(422, 'outside_geofence', { distance_meters: 10 });
    expect(err.statusCode).toBe(422);
    expect(err.reason).toBe('outside_geofence');
    expect(err.extra).toEqual({ distance_meters: 10 });
  });
});
