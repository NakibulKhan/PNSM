/**
 * GET /health is an operational endpoint (load balancers, Docker
 * HEALTHCHECK, uptime monitors) — not part of either client's API contract,
 * so it deliberately uses neither the mobile bare-body convention nor the
 * admin {data,error,meta} envelope. A flat, simple shape is the right
 * default here.
 */
import { Router, type Request, type Response } from 'express';
import { dbReadyState } from '../config/db';

const router = Router();
const startedAt = Date.now();

router.get('/health', (_req: Request, res: Response) => {
  const db = dbReadyState();
  const ok = db === 'connected';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    db,
  });
});

export default router;
