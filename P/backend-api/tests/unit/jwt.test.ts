import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, InvalidTokenError } from '@/utils/jwt';

describe('jwt utils', () => {
  it('signs and verifies an access token round trip', () => {
    const token = signAccessToken('user-123', 'employee');
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.role).toBe('employee');
  });

  it('signs and verifies a refresh token round trip', () => {
    const token = signRefreshToken('user-456', 'admin_hr');
    const claims = verifyRefreshToken(token);
    expect(claims.sub).toBe('user-456');
    expect(claims.role).toBe('admin_hr');
  });

  it('throws InvalidTokenError for a garbage token', () => {
    expect(() => verifyAccessToken('not-a-real-token')).toThrow(InvalidTokenError);
  });

  it('does not accept a refresh token as an access token', () => {
    const refreshToken = signRefreshToken('user-789', 'super_admin');
    // Two defences here: different secrets under HS256, AND the `typ` claim.
    // The typ claim is what protects RS256, where both tokens share one key —
    // without it a 7-day refresh token would work as a permanent access token.
    expect(() => verifyAccessToken(refreshToken)).toThrow(InvalidTokenError);
  });

  it('does not accept an access token as a refresh token', () => {
    const accessToken = signAccessToken('user-789', 'super_admin');
    expect(() => verifyRefreshToken(accessToken)).toThrow(InvalidTokenError);
  });

  it('stamps a token-kind claim on both token types', () => {
    expect(verifyAccessToken(signAccessToken('u', 'employee')).typ).toBe('access');
    expect(verifyRefreshToken(signRefreshToken('u', 'employee')).typ).toBe('refresh');
  });

  it('is role-agnostic — issues and verifies tokens identically for every role', () => {
    (['employee', 'admin_hr', 'super_admin'] as const).forEach((role) => {
      const token = signAccessToken('user-x', role);
      expect(verifyAccessToken(token).role).toBe(role);
    });
  });
});
