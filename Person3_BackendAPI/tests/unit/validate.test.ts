import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '@/middleware/validate';

/**
 * Regression test for a real bug this session's first live `docker compose
 * up` run against a genuine Express 5 server caught: `req.query` is a
 * getter-only accessor in Express 5 (a breaking change from Express 4, where
 * it was a plain writable property), so `validate`'s old
 * `req.query = result.data` line threw "Cannot set property query of
 * #<IncomingMessage> which has only a getter" on every single GET route that
 * validates query params — attendance, leave, dashboard/trend, employees.
 *
 * No existing test caught this: the unit suite calls service functions
 * directly (bypassing Express entirely), and the only two supertest-backed
 * integration tests (auth, health) don't validate a query. A hand-built
 * `{ query: {...} }` mock object here would not have reproduced the bug
 * either — it needs a REAL express Request, whose `query` getter comes from
 * the http.IncomingMessage prototype with no setter. Hence a real express()
 * app + supertest, not a mocked req/res pair.
 */
describe('validate() against a real Express 5 request', () => {
  const querySchema = z.object({
    status: z.enum(['pending', 'approved']).default('pending'),
    pageSize: z.coerce.number().int().positive().default(20),
  });

  function buildApp() {
    const app = express();
    app.get('/things', validate(querySchema, 'admin', 'query'), (req, res) => {
      res.json({ query: req.query });
    });
    return app;
  }

  it('replaces req.query with the parsed/coerced value instead of throwing', async () => {
    const res = await request(buildApp()).get('/things?status=approved&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: { status: 'approved', pageSize: 5 } });
  });

  it('applies zod defaults when a query param is omitted', async () => {
    const res = await request(buildApp()).get('/things');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: { status: 'pending', pageSize: 20 } });
  });

  it('still returns 422 (not a 500) for a query that fails validation', async () => {
    const res = await request(buildApp()).get('/things?status=bogus');
    expect(res.status).toBe(422);
  });

  it('leaves req.params/req.body assignment behavior unchanged', async () => {
    const app = express();
    app.use(express.json());
    const bodySchema = z.object({ name: z.string() });
    app.post('/things', validate(bodySchema, 'admin', 'body'), (req, res) => {
      res.json({ body: req.body });
    });
    const res = await request(app).post('/things').send({ name: 'ok', extra: 'stripped?' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { name: 'ok' } });
  });
});
