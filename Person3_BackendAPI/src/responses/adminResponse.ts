/**
 * ADR-1: admin routes return {data, error, meta?} on EVERY response,
 * success or failure, matching 01-API-CONTRACT.md exactly (Person 2's
 * api-client.ts throws if this envelope or its `error` field is missing).
 */
import type { Response } from 'express';

export interface AdminMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function adminOk<T>(res: Response, data: T, meta?: AdminMeta, status = 200): void {
  res.status(status).json({ data, error: null, ...(meta ? { meta } : {}) });
}

export function adminError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({ data: null, error: { code, message, ...(details !== undefined ? { details } : {}) } });
}
