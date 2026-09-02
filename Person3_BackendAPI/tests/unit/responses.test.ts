import { mobileOk, mobileError } from '@/responses/mobileResponse';
import { adminOk, adminError } from '@/responses/adminResponse';
import type { Response } from 'express';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('mobileResponse', () => {
  it('mobileOk sends the bare body with no envelope', () => {
    const res = mockRes();
    mobileOk(res, { status: 'approved', face_match_score: 91 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'approved', face_match_score: 91 });
  });

  it('mobileOk supports a custom status code', () => {
    const res = mockRes();
    mobileOk(res, { id: 'leave-1' }, 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('mobileError reports "rejected" for a 4xx business-rule failure', () => {
    const res = mockRes();
    mobileError(res, 422, 'outside_geofence');
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', reason: 'outside_geofence', face_match_score: null });
  });

  it('mobileError reports "rejected" for a 401 (pin_mismatch)', () => {
    const res = mockRes();
    mobileError(res, 401, 'pin_mismatch');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
  });

  it('mobileError reports "error" (not "rejected") for a 5xx — a server fault is not the employee\'s fault', () => {
    const res = mockRes();
    mobileError(res, 500, 'server_error');
    expect(res.json).toHaveBeenCalledWith({ status: 'error', reason: 'server_error', face_match_score: null });
  });

  it('mobileError merges extra fields into the body', () => {
    const res = mockRes();
    mobileError(res, 422, 'invalid_request', { details: { fieldErrors: {} } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_request', details: { fieldErrors: {} } }),
    );
  });
});

describe('adminResponse', () => {
  it('adminOk sends {data, error: null}', () => {
    const res = mockRes();
    adminOk(res, { name: 'Rafiq Hasan' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { name: 'Rafiq Hasan' }, error: null });
  });

  it('adminOk includes meta only when provided', () => {
    const res = mockRes();
    adminOk(res, [1, 2, 3], { page: 1, pageSize: 20, total: 3 });
    expect(res.json).toHaveBeenCalledWith({
      data: [1, 2, 3],
      error: null,
      meta: { page: 1, pageSize: 20, total: 3 },
    });
  });

  it('adminError sends {data: null, error: {code, message}}', () => {
    const res = mockRes();
    adminError(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' },
    });
  });

  it('adminError includes details only when provided', () => {
    const res = mockRes();
    adminError(res, 422, 'VALIDATION_FAILED', 'Some fields need attention.', { fieldErrors: { email: ['bad'] } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ details: { fieldErrors: { email: ['bad'] } } }) }),
    );
  });
});
