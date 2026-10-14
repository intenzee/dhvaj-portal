import { ApiError } from './api';

/**
 * Keeping a sign-in alive. A token is dropped only when the API says it is no
 * longer valid (401); a network error or a 5xx — the API restarting, a blip —
 * leaves it in place so the portal reconnects instead of asking to sign in.
 */

/** True when the API rejected the token itself, so signing in again is the fix. */
export function isSignedOut(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** Issued-at and expiry (ms since epoch) from a JWT, or null if it has none. */
export function tokenLifetime(token: string): { issuedAt: number; expiresAt: number } | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const { iat, exp } = JSON.parse(json) as { iat?: unknown; exp?: unknown };
    if (typeof exp !== 'number') return null;
    const expiresAt = exp * 1000;
    return { issuedAt: typeof iat === 'number' ? iat * 1000 : expiresAt, expiresAt };
  } catch {
    return null;
  }
}

/** Renew once half the token's life has passed (and always in its last 10 minutes). */
export function renewalDue(token: string, now: number = Date.now()): boolean {
  const life = tokenLifetime(token);
  if (!life || life.expiresAt <= now) return false;
  const halfway = life.issuedAt + (life.expiresAt - life.issuedAt) / 2;
  return now >= Math.min(halfway, life.expiresAt - 10 * 60_000);
}

/** Wait before the next attempt to reach the API: 1s, 2s, 4s … up to 10s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** attempt);
}
