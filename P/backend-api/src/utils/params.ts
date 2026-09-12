import type { Request } from 'express';

/**
 * Express 5's route-param typing allows `string | string[]` (path-to-regexp
 * v8 permits repeated-segment params that collect into an array). Every route
 * in this codebase uses simple, single-segment `:id` params, which are always
 * a plain string at runtime — this just gives that fact a name instead of an
 * `as string` cast at every call site.
 */
export function stringParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
