'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, CardBody } from '@/components/ui';

/**
 * Development sign-in. In non-production the API mints a token for a seeded user
 * by email; production replaces this with Microsoft Entra SSO. The quick-select
 * buttons cover the seeded personas so every role dashboard is one click away.
 */
const SEEDED = [
  { email: 'mp@hsdg.in', label: 'Managing Partner' },
  { email: 'partner.a@hsdg.in', label: 'Partner A (North)' },
  { email: 'partner.b@hsdg.in', label: 'Partner B (South)' },
  { email: 'manager.x@hsdg.in', label: 'Manager X' },
  { email: 'senior.y@hsdg.in', label: 'Senior Y' },
  { email: 'admin@hsdg.in', label: 'Administrator' },
];

export default function LoginPage(): JSX.Element {
  const { principal, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('mp@hsdg.in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && principal) router.replace('/');
  }, [loading, principal, router]);

  const signIn = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(value);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Is the API running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardBody className="p-6">
          <div className="mb-1 text-2xl font-bold tracking-tight text-brand-700">HSDG Portal</div>
          <p className="mb-6 text-sm text-ink-muted">
            Sign in to the practice portal. (Development sign-in — production uses Microsoft Entra
            SSO.)
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn(email);
            }}
            className="space-y-3"
          >
            <label className="block text-sm font-medium text-ink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              autoComplete="username"
            />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          <div className="mt-6">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Quick sign-in (seeded users)
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SEEDED.map((u) => (
                <button
                  key={u.email}
                  onClick={() => void signIn(u.email)}
                  disabled={busy}
                  className="rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-ink-muted transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                >
                  <div className="font-medium text-ink">{u.label}</div>
                  <div className="text-ink-faint">{u.email}</div>
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
