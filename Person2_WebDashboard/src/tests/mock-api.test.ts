/**
 * Contract tests for the built-in mock backend. These also serve as executable
 * documentation of the shapes Person 3's API must return.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { handleMockRequest, resetMockStore } from '@/mocks/mock-api';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import type { ApiEnvelope } from '@/types/api';
import type { AttendanceLog, Geofence, Office } from '@/types/models';

const params = (init: Record<string, string> = {}) => new URLSearchParams(init);

const body = <T,>(result: { body: unknown }) => (result.body as ApiEnvelope<T>).data;

beforeEach(() => {
  resetMockStore();
});

describe('envelope shape', () => {
  it('wraps success in { data, error: null }', () => {
    const result = handleMockRequest('GET', 'offices', params(), undefined);
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('data');
    expect((result.body as ApiEnvelope<unknown>).error).toBeNull();
  });

  it('returns a typed error envelope for an unknown route', () => {
    const result = handleMockRequest('GET', 'nonsense', params(), undefined);
    expect(result.status).toBe(404);
    expect((result.body as ApiEnvelope<unknown>).error?.code).toBe('NO_ROUTE');
  });

  it('includes pagination meta on list endpoints', () => {
    const result = handleMockRequest('GET', 'employees', params({ page: '1', pageSize: '5' }), undefined);
    const envelope = result.body as ApiEnvelope<unknown[]>;
    expect(envelope.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(envelope.meta!.total).toBeGreaterThan(5);
    expect(envelope.data).toHaveLength(5);
  });
});

describe('auth', () => {
  it('signs in an HR account', () => {
    const result = handleMockRequest('POST', 'auth/login', params(), {
      email: 'hr@pnsm.test',
      password: 'demo1234',
    });
    expect(result.status).toBe(200);
  });

  it('refuses an employee account on the admin portal', () => {
    const employees = body<{ email: string }[]>(
      handleMockRequest('GET', 'employees', params(), undefined),
    );
    const result = handleMockRequest('POST', 'auth/login', params(), {
      email: employees[0].email,
      password: 'demo1234',
    });
    expect(result.status).toBe(403);
  });

  it('rejects a short password', () => {
    const result = handleMockRequest('POST', 'auth/login', params(), {
      email: 'hr@pnsm.test',
      password: '123',
    });
    expect(result.status).toBe(401);
  });
});

describe('geospatial storage', () => {
  it('stores geofence centres as GeoJSON [lng, lat]', () => {
    const fences = body<Geofence[]>(handleMockRequest('GET', 'geofences', params(), undefined));
    fences.forEach((fence) => {
      const [lng, lat] = fence.location.coordinates;
      expect(fence.location.type).toBe('Point');
      // Dhaka: longitude ~90, latitude ~23. Reversed values would fail here.
      expect(lng).toBeGreaterThan(88);
      expect(lng).toBeLessThan(93);
      expect(lat).toBeGreaterThan(20);
      expect(lat).toBeLessThan(27);
    });
  });

  it('stores a geofence created from flat lat/lng input in GeoJSON order', () => {
    const created = body<Geofence>(
      handleMockRequest('POST', 'geofences', params(), {
        office_name: 'Test Office',
        address: 'Somewhere',
        lat: 23.75,
        lng: 90.39,
        radius_meters: 75,
      }),
    );
    expect(created.location.coordinates).toEqual([90.39, 23.75]);
    expect(created.radius_meters).toBe(75);
  });
});

describe('attendance', () => {
  it('filters by verification status', () => {
    const flagged = body<AttendanceLog[]>(
      handleMockRequest('GET', 'attendance', params({ status: 'flagged', pageSize: '500' }), undefined),
    );
    flagged.forEach((log) => expect(log.status).toBe('flagged'));
  });

  it('keeps status consistent with the threshold rule', () => {
    const rows = body<AttendanceLog[]>(
      handleMockRequest('GET', 'attendance', params({ pageSize: '500' }), undefined),
    );
    rows
      .filter((log) => log.status === 'approved')
      .forEach((log) => expect(log.face_match_score).toBeGreaterThanOrEqual(FACE_MATCH_THRESHOLD));
  });

  it('approves a flagged check-in', () => {
    const flagged = body<AttendanceLog[]>(
      handleMockRequest('GET', 'attendance', params({ status: 'flagged', pageSize: '10' }), undefined),
    );
    // The seeded dataset always contains flagged rows, but assert rather than
    // index blindly so a seed change produces a clear failure, not a TypeError.
    expect(flagged.length).toBeGreaterThan(0);
    const updated = body<AttendanceLog>(
      handleMockRequest('POST', `attendance/${flagged[0]._id}/approve`, params(), undefined),
    );
    expect(updated.status).toBe('approved');
  });

  it('returns dashboard KPIs in the documented shape', () => {
    const kpis = body<Record<string, number>>(
      handleMockRequest('GET', 'dashboard/kpis', params(), undefined),
    );
    ['checkedInToday', 'onLeave', 'lateArrivals', 'avgFaceMatch', 'totalEmployees', 'flaggedToday'].forEach(
      (key) => expect(typeof kpis[key]).toBe('number'),
    );
  });

  it('returns exactly seven trend points for a week', () => {
    const trend = body<{ date: string; count: number }[]>(
      handleMockRequest('GET', 'dashboard/trend', params({ days: '7' }), undefined),
    );
    expect(trend).toHaveLength(7);
    trend.forEach((point) => expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });
});

describe('onboarding', () => {
  it('creates an employee, issues a PIN and enrols a baseline', () => {
    const offices = body<Office[]>(handleMockRequest('GET', 'offices', params(), undefined));
    const result = handleMockRequest('POST', 'employees', params(), {
      name: 'Test Employee',
      employee_code: 'PNSM-9999',
      email: 'test.employee@pnsm.test',
      phone: '01712345678',
      department: 'Engineering',
      office_id: offices[0]._id,
      reference_photo_url: 'https://example.test/photo.jpg',
      shift_start: '09:00',
      shift_end: '18:00',
      days_of_week: 'Sun-Thu',
    });

    expect(result.status).toBe(201);
    const created = body<{
      employee: { name: string; has_face_embedding: boolean };
      generated_pin: string;
    }>(result);
    expect(created.employee.name).toBe('Test Employee');
    expect(created.employee.has_face_embedding).toBe(true);
    expect(created.generated_pin).toMatch(/^\d{4}$/);
  });
});
