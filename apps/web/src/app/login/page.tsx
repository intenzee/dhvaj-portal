'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AFTER_SIGN_IN } from '@/components/landing-redirect';
import { ApiError } from '@/lib/api';
import { Button, Card, CardBody } from '@/components/ui';
import { Field, Input } from '@/components/form';

/**
 * Sign-in. Staff type the email and portal password an administrator gave
 * them (a temporary one must be replaced at first sign-in), or use Microsoft
 * Entra SSO once the tenant/app registration is configured via env. In local
 * dev, the API mints a token for a seeded user (this path is disabled in
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
  const {
    principal,
    loading,
    login,
    loginWithEntra,
    entraEnabled,
    loginWithPassword,
    changePassword,
    passwordEnabled,
  } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Set once a temporary password is accepted: the person chooses their own.
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!loading && principal) router.replace(AFTER_SIGN_IN);
  }, [loading, principal, router]);

  const run = async (fn: () => Promise<void>, fallbackMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.replace(AFTER_SIGN_IN);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMsg);
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if ((await loginWithPassword(email.trim(), password)) === 'must_change') {
        setMustChange(true);
        return;
      }
      router.replace(AFTER_SIGN_IN);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const chooseOwnPassword = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    void run(
      () => changePassword(email.trim(), password, newPassword),
      'Could not set your password. Please try again.',
    );
  };

  const backToSignIn = () => {
    setMustChange(false);
    setPassword('');
    setNewPassword('');
    setConfirm('');
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-4">
      <Card className="w-full max-w-md">
        <CardBody className="p-6">
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-sm font-black text-white">
              D
            </div>
            <div className="text-2xl font-bold tracking-tight text-ink">
              Dhvaj <span className="text-ink-faint">Portal</span>
            </div>
          </div>
          <p className="mb-6 text-sm text-ink-muted">
            {mustChange
              ? 'Welcome! Choose your own password to finish signing in.'
              : 'Sign in to the practice portal.'}
          </p>

          {passwordEnabled && mustChange && (
            <form onSubmit={chooseOwnPassword} className="space-y-3">
              <Field
                label="New password"
                hint="At least 10 characters. Avoid your name and common words."
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={10}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={10}
                  required
                />
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Saving…' : 'Set password and sign in'}
              </Button>
              <button
                type="button"
                onClick={backToSignIn}
                className="w-full text-center text-xs text-ink-muted hover:text-ink"
              >
                Back to sign-in
              </button>
            </form>
          )}

          {passwordEnabled && !mustChange && (
            <form onSubmit={(e) => void signInWithPassword(e)} className="space-y-3">
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@dhvaj.in"
                  required
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-xs text-ink-faint">
                Forgot your password? Ask an administrator to reset it.
              </p>
            </form>
          )}

          {passwordEnabled && entraEnabled && !mustChange && (
            <div className="my-4 flex items-center gap-2 text-xs uppercase tracking-wide text-ink-faint">
              <span className="h-px flex-1 bg-line-strong" />
              <span>or</span>
              <span className="h-px flex-1 bg-line-strong" />
            </div>
          )}

          {entraEnabled && !mustChange && (
            <Button
              onClick={() => void run(loginWithEntra, 'Microsoft sign-in failed.')}
              disabled={busy}
              variant={passwordEnabled ? 'secondary' : 'primary'}
              className="w-full"
            >
              {busy ? 'Signing in…' : 'Sign in with Microsoft'}
            </Button>
          )}

          {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

          {/* A production build with Microsoft sign-in shows no personas: the API
              refuses developer sign-in there, and the personas aren't real staff. */}
          {!mustChange && !(entraEnabled && process.env.NODE_ENV === 'production') && (
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
                Developer sign-in is disabled in production; there, staff use their portal password
                or Microsoft.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
