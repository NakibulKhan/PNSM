import { createRateLimiter, resetBlockCounts } from '@/middleware/rateLimiter';
import type { Request, Response } from 'express';

function mockRes(routeGroup?: 'mobile' | 'admin') {
  const res: Partial<Response> = { locals: routeGroup ? { routeGroup } : {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return { ip: '10.0.0.1', path: '/api/admin/some-route', ...overrides } as Request;
}

describe('createRateLimiter', () => {
  beforeEach(() => resetBlockCounts());

  it('allows requests under the budget', async () => {
    const limiter = createRateLimiter({ keyPrefix: `t-allow-${Date.now()}`, points: 3, durationSec: 60 });
    const req = mockReq();
    const res = mockRes('admin');
    const next = jest.fn();

    await limiter(req, res, next);
    await limiter(req, res, next);
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks once the budget is exceeded, with a Retry-After header', async () => {
    const limiter = createRateLimiter({ keyPrefix: `t-block-${Date.now()}`, points: 1, durationSec: 60 });
    const req = mockReq();
    const res = mockRes('admin');
    const next = jest.fn();

    await limiter(req, res, next);
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('returns the mobile bare-body shape for a mobile route group', async () => {
    const limiter = createRateLimiter({ keyPrefix: `t-mobile-${Date.now()}`, points: 0, durationSec: 60 });
    const res = mockRes('mobile');
    const next = jest.fn();

    await limiter(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', reason: 'rate_limited', face_match_score: null });
  });

  it('returns the admin {data,error} shape for an admin route group (default)', async () => {
    const limiter = createRateLimiter({ keyPrefix: `t-admin-${Date.now()}`, points: 0, durationSec: 60 });
    const res = mockRes();
    const next = jest.fn();

    await limiter(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ data: null, error: { code: 'RATE_LIMITED', message: expect.any(String) } });
  });

  it('scopes the composite key by user, not just IP — two users on one IP get independent budgets', async () => {
    const prefix = `t-composite-${Date.now()}`;
    const limiter = createRateLimiter({ keyPrefix: prefix, points: 1, durationSec: 60 });
    const res = mockRes('admin');
    const next = jest.fn();

    await limiter(mockReq({ auth: { sub: 'user-a', role: 'employee' } } as Partial<Request>), res, next);
    await limiter(mockReq({ auth: { sub: 'user-b', role: 'employee' } } as Partial<Request>), res, next);

    // Both consumed their own single point successfully — neither was blocked
    // by the other's usage, proving the key includes the user id.
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls onBlocked with an incrementing blockCount per (ip, route)', async () => {
    const onBlocked = jest.fn();
    const limiter = createRateLimiter({ keyPrefix: `t-escalate-${Date.now()}`, points: 0, durationSec: 60, onBlocked });
    const res = mockRes('admin');

    await limiter(mockReq(), res, jest.fn());
    await limiter(mockReq(), res, jest.fn());

    expect(onBlocked).toHaveBeenNthCalledWith(1, expect.objectContaining({ blockCount: 1 }));
    expect(onBlocked).toHaveBeenNthCalledWith(2, expect.objectContaining({ blockCount: 2 }));
  });
});
