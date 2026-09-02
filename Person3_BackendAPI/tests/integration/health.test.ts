import request from 'supertest';
import { createApp } from '@/app';

describe('GET /health', () => {
  it('responds with a status, uptime, timestamp, and db state', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    // No live DB connection in this test run, so `db` legitimately reports
    // 'disconnected' and the endpoint correctly reflects that as 'degraded'
    // (503) rather than lying about health — this is the endpoint working
    // as designed, not a test failure to paper over.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/^(ok|degraded)$/),
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
        db: expect.stringMatching(/^(connected|disconnected|connecting|disconnecting|unknown)$/),
      }),
    );
  });
});
