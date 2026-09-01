'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, CardBody } from '@/components/ui';

/**
 * Sign-in. Production uses Microsoft Entra SSO (secure, MFA — no passwords stored
 * by us); it appears once the tenant/app registration is configured via env. In
 * local dev, the API mints a token for a seeded user (this path is disabled in
 * production), with quick-select personas for each role.
 */
const SEEDED = [
  { email: 'mp@dhvaj.in', label: 'Managing Partner' },
  { email: 'partner.a@dhvaj.in', label: 'Partner A (North)' },
  { email: 'partner.b@dhvaj.in', label: 'Partner B (South)' },
  { email: 'manager.x@dhvaj.in', label: 'Manager X' },
  { email: 'senior.y@dhvaj.in', label: 'Senior Y' },
  { email: 'admin@dhvaj.in', label: 'Administrator' },
];

export default function LoginPage(): JSX.Element {
  const { principal, loading, login, loginWithEntra, entraEnabled } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && principal) router.replace('/');
  }, [loading, principal, router]);

  const run = async (fn: () => Promise<void>, fallbackMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMsg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4">
      <Card className="w-full max-w-md">
        <CardBody className="p-6">
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-sm font-black text-white">
              H
            </div>
            <div className="text-2xl font-bold tracking-tight text-ink">
              Dhvaj <span className="text-ink-faint">Portal</span>
            </div>
          </div>
          <p className="mb-6 text-sm text-ink-muted">Sign in to the practice portal.</p>

          {entraEnabled && (
            <Button
              onClick={() => void run(loginWithEntra, 'Microsoft sign-in failed.')}
              disabled={busy}
              className="w-full"
            >
              {busy ? 'Signing in…' : 'Sign in with Microsoft'}
            </Button>
          )}

          {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              <span>{entraEnabled ? 'Developer sign-in (local only)' : 'Developer sign-in'}</span>
              <span className="h-px flex-1 bg-line-strong" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SEEDED.map((u) => (
                <button
                  key={u.email}
                  onClick={() => void run(() => login(u.email), 'Sign-in failed. Is the API running?')}
                  disabled={busy}
                  className="rounded-lg border border-line-strong px-3 py-2 text-left text-xs transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50"
                >
                  <div className="font-medium text-ink">{u.label}</div>
                  <div className="text-ink-faint">{u.email}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Developer sign-in is disabled in production; there, sign-in goes through Microsoft
              Entra SSO with MFA.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
