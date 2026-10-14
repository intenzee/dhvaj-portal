import { ApiError } from '../api';
import { isSignedOut, reconnectDelay, renewalDue, tokenLifetime } from '../session';

/** An unsigned JWT with the given claims (only the payload is read). */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

describe('session', () => {
  const iat = 1_800_000_000;
  const hour = jwt({ sub: 'a@b.c', iat, exp: iat + 3600 });

  it('only a 401 means signed out — not a network error or a restart', () => {
    expect(isSignedOut(new ApiError(401, 'expired'))).toBe(true);
    expect(isSignedOut(new ApiError(503, 'down'))).toBe(false);
    expect(isSignedOut(new ApiError(500, 'boom'))).toBe(false);
    expect(isSignedOut(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('reads the token lifetime', () => {
    expect(tokenLifetime(hour)).toEqual({ issuedAt: iat * 1000, expiresAt: (iat + 3600) * 1000 });
    expect(tokenLifetime('not-a-token')).toBeNull();
    expect(tokenLifetime(jwt({ sub: 'x' }))).toBeNull();
  });

  it('renews past half its life, never once expired', () => {
    expect(renewalDue(hour, (iat + 60) * 1000)).toBe(false);
    expect(renewalDue(hour, (iat + 1801) * 1000)).toBe(true);
    expect(renewalDue(hour, (iat + 3601) * 1000)).toBe(false);
    // A long-lived token still renews in its last 10 minutes.
    const day = jwt({ iat, exp: iat + 86_400 });
    expect(renewalDue(day, (iat + 3600) * 1000)).toBe(false);
    expect(renewalDue(day, (iat + 86_400 - 300) * 1000)).toBe(true);
  });

  it('backs off reconnecting up to 10 seconds', () => {
    expect([0, 1, 2, 3, 4, 8].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });
});
