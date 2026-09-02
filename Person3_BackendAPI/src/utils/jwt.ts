/**
 * Custom JWT pipeline (blueprint Quadrant III). Deliberately in-house rather
 * than Firebase — the blueprint eliminates third-party identity vendor
 * lock-in, and Firebase has no concept of the HR-issued 2FA PIN that FR-06
 * requires.
 *
 * Dual-token architecture:
 *   - Access token  — short-lived (15m), returned in the JSON body, held in
 *                     transient client memory.
 *   - Refresh token — long-lived (7d), additionally set as an HttpOnly,
 *                     Secure, SameSite=Strict cookie so browser JavaScript
 *                     physically cannot read it (XSS mitigation).
 *
 * Signing algorithm is selectable. RS256 (asymmetric) is the blueprint's
 * preferred option and is what production should use: only the auth service
 * holds the private key, so a compromised read-only service can verify tokens
 * but cannot mint them. HS256 with a high-entropy secret is the documented
 * fallback and remains the default for local/dev, because RS256 requires a
 * keypair to exist before the server will boot.
 */
import jwt, { type JwtPayload, type SignOptions, type Secret } from 'jsonwebtoken';
import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_TTL,
  JWT_REFRESH_TTL,
  JWT_ALGORITHM,
  JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY,
} from '../config/env';
import type { RoleKey } from '../constants';

export interface TokenClaims extends JwtPayload {
  sub: string;
  role: RoleKey;
}

type TokenKind = 'access' | 'refresh';

function signingKey(kind: TokenKind): Secret {
  if (JWT_ALGORITHM === 'RS256') {
    if (!JWT_PRIVATE_KEY) {
      throw new Error('JWT_ALGORITHM is RS256 but JWT_PRIVATE_KEY is not set');
    }
    return JWT_PRIVATE_KEY;
  }
  return kind === 'access' ? JWT_ACCESS_SECRET : JWT_REFRESH_SECRET;
}

function verificationKey(kind: TokenKind): Secret {
  if (JWT_ALGORITHM === 'RS256') {
    if (!JWT_PUBLIC_KEY) {
      throw new Error('JWT_ALGORITHM is RS256 but JWT_PUBLIC_KEY is not set');
    }
    return JWT_PUBLIC_KEY;
  }
  return kind === 'access' ? JWT_ACCESS_SECRET : JWT_REFRESH_SECRET;
}

function sign(userId: string, role: RoleKey, kind: TokenKind): string {
  const options: SignOptions = {
    expiresIn: (kind === 'access' ? JWT_ACCESS_TTL : JWT_REFRESH_TTL) as SignOptions['expiresIn'],
    algorithm: JWT_ALGORITHM,
  };
  // `typ` distinguishes the two token kinds. Under RS256 both are signed with
  // the SAME key, so without this claim a refresh token would verify perfectly
  // well as an access token — turning a 7-day credential into a permanent API
  // key. Checked on every verify below.
  return jwt.sign({ sub: userId, role, typ: kind }, signingKey(kind), options);
}

export function signAccessToken(userId: string, role: RoleKey): string {
  return sign(userId, role, 'access');
}

export function signRefreshToken(userId: string, role: RoleKey): string {
  return sign(userId, role, 'refresh');
}

export class InvalidTokenError extends Error {
  constructor(message = 'Invalid or expired token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

function verify(token: string, kind: TokenKind): TokenClaims {
  try {
    const claims = jwt.verify(token, verificationKey(kind), {
      algorithms: [JWT_ALGORITHM],
    }) as TokenClaims & { typ?: TokenKind };

    // Reject a token of the wrong kind even when the signature is valid.
    // Under HS256 the two secrets already differ so this is belt-and-braces;
    // under RS256 it is the ONLY thing preventing refresh-token-as-access-token.
    if (claims.typ !== undefined && claims.typ !== kind) {
      throw new InvalidTokenError();
    }
    return claims;
  } catch {
    throw new InvalidTokenError();
  }
}

export function verifyAccessToken(token: string): TokenClaims {
  return verify(token, 'access');
}

export function verifyRefreshToken(token: string): TokenClaims {
  return verify(token, 'refresh');
}

/** Cookie name carrying the refresh token. */
export const REFRESH_COOKIE_NAME = 'pnsm_refresh';

/**
 * Cookie attributes per the blueprint's OWASP directive. `secure` is disabled
 * outside production only because localhost is served over plain HTTP — it
 * must never be false in a deployed environment.
 */
export function refreshCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
