import type { RoleKey } from '../constants';

export interface AuthenticatedPrincipal {
  sub: string; // user _id
  role: RoleKey;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by src/middleware/auth.ts after verifying the bearer JWT. */
      auth?: AuthenticatedPrincipal;
    }
  }
}

export {};
