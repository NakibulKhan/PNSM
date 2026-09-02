import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';
import { MobileApiError, AdminApiError } from '@/utils/errors';
import type { Request, Response, NextFunction } from 'express';

function mockRes(routeGroup?: 'mobile' | 'admin') {
  const res: Partial<Response> = { locals: routeGroup ? { routeGroup } : {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(): Request {
  return { path: '/test', method: 'GET' } as Request;
}

describe('errorHandler', () => {
  const next = jest.fn() as unknown as NextFunction;

  it('formats a MobileApiError as a bare rejected body for a 4xx', () => {
    const res = mockRes();
    errorHandler(new MobileApiError(422, 'outside_geofence'), mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', reason: 'outside_geofence', face_match_score: null });
  });

  it('formats a MobileApiError thrown with a 5xx as "error", not "rejected"', () => {
    const res = mockRes();
    errorHandler(new MobileApiError(500, 'server_error'), mockReq(), res, next);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', reason: 'server_error', face_match_score: null });
  });

  it('formats an AdminApiError as the {data,error} envelope', () => {
    const res = mockRes();
    errorHandler(new AdminApiError(403, 'FORBIDDEN', 'You do not have permission.'), mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ data: null, error: { code: 'FORBIDDEN', message: 'You do not have permission.' } });
  });

  it('includes details on an AdminApiError when provided', () => {
    const res = mockRes();
    errorHandler(new AdminApiError(422, 'VALIDATION_FAILED', 'Bad input.', { field: 'email' }), mockReq(), res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ details: { field: 'email' } }) }),
    );
  });

  it('falls back to a generic admin 500 for an unexpected error with no routeGroup set', () => {
    const res = mockRes(); // no routeGroup set
    errorHandler(new Error('boom'), mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end. Please try again shortly.' },
    });
  });

  it('falls back to a generic mobile 500 for an unexpected error when routeGroup is "mobile"', () => {
    const res = mockRes('mobile');
    errorHandler(new Error('boom'), mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', reason: 'server_error', face_match_score: null });
  });

  it('never leaks the underlying error message or stack to the client response', () => {
    const res = mockRes();
    errorHandler(new Error('leaked secret database connection string'), mockReq(), res, next);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('leaked secret');
  });

  it('reports a malformed JSON body (express.json()-style error) as 400, not 500', () => {
    const res = mockRes();
    const bodyParserError = Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' });
    errorHandler(bodyParserError, mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ data: null, error: { code: 'BAD_REQUEST', message: 'The request could not be understood.' } });
  });

  it('reports a malformed body as a bare 400 for a mobile route', () => {
    const res = mockRes('mobile');
    const bodyParserError = Object.assign(new Error('Unexpected token'), { statusCode: 400 });
    errorHandler(bodyParserError, mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', reason: 'invalid_request', face_match_score: null });
  });

  it('does not treat a 5xx-shaped plain error as a client error', () => {
    const res = mockRes();
    const serverError = Object.assign(new Error('db down'), { status: 503 });
    errorHandler(serverError, mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('notFoundHandler', () => {
  it('returns the admin {data,error} shape by default', () => {
    const res = mockRes();
    notFoundHandler(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: null, error: expect.objectContaining({ code: 'NOT_FOUND' }) }));
  });

  it('returns the mobile bare shape when routeGroup is "mobile"', () => {
    const res = mockRes('mobile');
    notFoundHandler(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', reason: 'invalid_request', face_match_score: null });
  });
});
