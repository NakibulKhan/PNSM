import type { Request, Response } from 'express';

jest.mock('@/config/db', () => ({ dbReadyState: jest.fn() }));
jest.mock('@/services/incidentService', () => ({ recordIncident: jest.fn() }));
jest.mock('@/models', () => ({ IncidentBlocklist: { findOne: jest.fn() } }));
jest.mock('@/utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { escalateToIncident, incidentBlocklistGuard } from '@/middleware/incidentBlocklist';
import { dbReadyState } from '@/config/db';
import { recordIncident } from '@/services/incidentService';
import { IncidentBlocklist } from '@/models';
import { logger } from '@/utils/logger';

function mockRes(routeGroup?: 'mobile' | 'admin') {
  const res: Partial<Response> = { locals: routeGroup ? { routeGroup } : {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const mockReq = { ip: '10.0.0.5' } as Request;

describe('escalateToIncident', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing below the escalation threshold', () => {
    escalateToIncident({ ip: '1.2.3.4', route: 'admin-login', blockCount: 1 });
    expect(recordIncident).not.toHaveBeenCalled();
  });

  it('records an incident once the block count reaches the threshold', () => {
    (recordIncident as jest.Mock).mockResolvedValue(undefined);
    escalateToIncident({ ip: '1.2.3.4', route: 'admin-login', blockCount: 2 });
    expect(recordIncident).toHaveBeenCalledWith('1.2.3.4', expect.stringContaining('admin-login'), 2);
  });

  it('logs rather than throws if the durable write fails', async () => {
    (recordIncident as jest.Mock).mockRejectedValue(new Error('mongo down'));
    expect(() => escalateToIncident({ ip: '1.2.3.4', route: 'admin-login', blockCount: 3 })).not.toThrow();
    await Promise.resolve().then(() => Promise.resolve()); // flush the rejected promise's .catch()
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('incidentBlocklistGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips the DB lookup entirely when not connected (e.g. this test run)', async () => {
    (dbReadyState as jest.Mock).mockReturnValue('disconnected');
    const next = jest.fn();
    await incidentBlocklistGuard(mockReq, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(IncidentBlocklist.findOne).not.toHaveBeenCalled();
  });

  it('calls next() when no active block exists', async () => {
    (dbReadyState as jest.Mock).mockReturnValue('connected');
    (IncidentBlocklist.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const next = jest.fn();
    await incidentBlocklistGuard(mockReq, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects with 403 (admin shape) when a block is active', async () => {
    (dbReadyState as jest.Mock).mockReturnValue('connected');
    (IncidentBlocklist.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ ip: '10.0.0.5' }) });
    const res = mockRes('admin');
    const next = jest.fn();
    await incidentBlocklistGuard(mockReq, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ data: null, error: { code: 'IP_BLOCKED', message: expect.any(String) } });
  });

  it('rejects with 403 (mobile shape) when a block is active on a mobile route', async () => {
    (dbReadyState as jest.Mock).mockReturnValue('connected');
    (IncidentBlocklist.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ ip: '10.0.0.5' }) });
    const res = mockRes('mobile');
    const next = jest.fn();
    await incidentBlocklistGuard(mockReq, res, next);
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected', reason: 'ip_blocked', face_match_score: null });
  });

  it('fails open (calls next) and logs if the lookup itself errors', async () => {
    (dbReadyState as jest.Mock).mockReturnValue('connected');
    (IncidentBlocklist.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('timeout')) });
    const next = jest.fn();
    await incidentBlocklistGuard(mockReq, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
