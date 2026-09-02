import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { MobileApiError, AdminApiError } from '../utils/errors';

type Part = 'body' | 'query' | 'params';

/**
 * Validates `req[part]` against `schema`, replacing it with the parsed
 * (typed, defaulted) value on success. `group` picks which error shape gets
 * thrown on failure — must match the router this middleware is mounted on
 * (ADR-1 keeps the two conventions structurally separate rather than
 * inferred).
 */
export function validate(schema: ZodSchema, group: 'mobile' | 'admin', part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.flatten();
      if (group === 'mobile') {
        next(new MobileApiError(422, 'invalid_request', { details }));
        return;
      }
      next(new AdminApiError(422, 'VALIDATION_FAILED', 'Some fields need attention.', details));
      return;
    }
    (req[part] as unknown) = result.data;
    next();
  };
}
