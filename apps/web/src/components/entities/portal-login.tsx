'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, KeyRound, Pencil, Trash2 } from 'lucide-react';
import {
  CREDENTIAL_SHOW_SECONDS,
  PERMISSION,
  type EntityCredentials,
  type RegistrationCredential,
  type RevealedCredential,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui';

/**
 * ADR-0035 — a client's saved GST portal login. Lists carry only a masked user
 * name; "Show" asks the server for the login (logged, rate-limited), keeps it
 * in this component's state only, and hides it again after
 * CREDENTIAL_SHOW_SECONDS. Managers can add, change or remove it.
 */

/** The query key for one client's or one registration's logins. */
export const credentialsKey = (by: { entityId?: string; registrationId?: string }) => [
  'credentials',
  by.entityId ?? null,
  by.registrationId ?? null,
];

export function useCredentials(by: { entityId?: string; registrationId?: string }) {
  const { principal } = useAuth();
  const q = by.entityId ? `entityId=${by.entityId}` : `registrationId=${by.registrationId}`;
  return useQuery({
    queryKey: credentialsKey(by),
    queryFn: () => apiFetch<EntityCredentials>(`/credentials?${q}`),
    enabled: Boolean(by.entityId || by.registrationId) && can(principal, PERMISSION.entityRead),
  });
}

/** "Hides in 12s" — the seconds left of a shown login. Pure — tested. */
export function hidesIn(shownAt: number, now: number): number {
  return Math.max(0, CREDENTIAL_SHOW_SECONDS - Math.floor((now - shownAt) / 1000));
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, what }: { text: string; what: string }): JSX.Element {
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={`Copy ${what}`}
      title={`Copy ${what}`}
      className="rounded p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      onClick={() =>
        void copy(text).then((ok) =>
          toast(
            ok ? `${what[0]!.toUpperCase()}${what.slice(1)} copied.` : 'Could not copy.',
            ok ? 'success' : 'error',
          ),
        )
      }
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

/** The login, shown for a while; forgets it on hide, timeout or unmount. */
function Shown({ login, onHide }: { login: RevealedCredential; onHide: () => void }): JSX.Element {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = hidesIn(shownAt, now);
  useEffect(() => {
    if (left === 0) onHide();
  }, [left, onHide]);
  return (
    <div className="mt-1.5 rounded-md border border-line-strong bg-surface-sunken px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="w-16 text-ink-muted">User name</span>
        <span className="font-mono text-ink">{login.username}</span>
        <CopyButton text={login.username} what="user name" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-16 text-ink-muted">Password</span>
        <span className="font-mono text-ink">{login.password}</span>
        <CopyButton text={login.password} what="password" />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-ink-faint">
        <span>Hides in {left}s · this view is logged</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-ink"
          onClick={onHide}
        >
          <EyeOff className="h-3.5 w-3.5" /> Hide
        </button>
      </div>
    </div>
  );
}

function LoginForm({
  registrationId,
  existing,
  onDone,
}: {
  registrationId: string;
  existing: boolean;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<RegistrationCredential>('/credentials', {
        method: 'PUT',
        body: { registrationId, portal: 'gst', username, password },
      }),
    onSuccess: () => {
      setPassword('');
      void qc.invalidateQueries({ queryKey: ['credentials'] });
      toast('GST login saved (encrypted).', 'success');
      onDone();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the login.', 'error'),
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (username.trim() && password) save.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <input
        aria-label="GST user name"
        placeholder="GST user name"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-36 rounded border border-line-strong px-2 py-1"
      />
      <input
        aria-label="GST password"
        placeholder="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-36 rounded border border-line-strong px-2 py-1"
      />
      <Button size="sm" type="submit" disabled={save.isPending || !username.trim() || !password}>
        {existing ? 'Replace' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** One registration's GST login: hint + Show, and Add / Change / Remove for managers. */
export function PortalLogin({
  registrationId,
  credential,
  vaultReady,
}: {
  registrationId: string;
  credential: RegistrationCredential | undefined;
  vaultReady: boolean;
}): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canReveal = can(principal, PERMISSION.credentialReveal);
  const canManage = can(principal, PERMISSION.credentialManage);
  const [shown, setShown] = useState<RevealedCredential | null>(null);
  const [editing, setEditing] = useState(false);

  const reveal = useMutation({
    mutationFn: (id: string) =>
      apiFetch<RevealedCredential>(`/credentials/${id}/reveal`, { method: 'POST' }),
    onSuccess: (login) => {
      setShown(login);
      void qc.invalidateQueries({ queryKey: ['credentials'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not show the login.', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/credentials/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setShown(null);
      void qc.invalidateQueries({ queryKey: ['credentials'] });
      toast('GST login removed.', 'success');
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not remove the login.', 'error'),
  });

  if (!credential && !canManage) return null;
  if (!vaultReady)
    return (
      <p className="mt-1 text-xs text-ink-faint">
        Logins cannot be saved yet: the server has no encryption key.
      </p>
    );

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <KeyRound className="h-3.5 w-3.5 text-ink-faint" />
        {credential ? (
          <>
            <span className="text-ink-muted">GST login</span>
            <span className="font-mono text-ink">{credential.usernameHint}</span>
            <span className="text-ink-faint">· ••••••••</span>
            {canReveal && !shown && (
              <Button
                size="sm"
                variant="subtle"
                className="px-2 py-0.5"
                disabled={reveal.isPending}
                onClick={() => reveal.mutate(credential.id)}
              >
                <Eye className="h-3.5 w-3.5" /> Show
              </Button>
            )}
            {canManage && !editing && (
              <>
                <button
                  type="button"
                  aria-label="Change GST login"
                  title={`Change · saved ${formatDate(credential.updatedAt)}${credential.updatedBy ? ` by ${credential.updatedBy}` : ''}`}
                  className="rounded p-1 text-ink-muted hover:bg-surface-sunken"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remove GST login"
                  title="Remove"
                  className="rounded p-1 text-ink-muted hover:bg-surface-sunken hover:text-danger-600"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm('Remove the saved GST login for this GSTIN?'))
                      remove.mutate(credential.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </>
        ) : (
          !editing && (
            <button
              type="button"
              className="text-primary-700 hover:underline"
              onClick={() => setEditing(true)}
            >
              Add GST login
            </button>
          )
        )}
      </div>
      {shown && <Shown login={shown} onHide={() => setShown(null)} />}
      {editing && (
        <LoginForm
          registrationId={registrationId}
          existing={Boolean(credential)}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/** Partners: who looked at this client's logins recently. */
export function CredentialAccessNote({
  data,
}: {
  data: EntityCredentials | undefined;
}): JSX.Element | null {
  const recent = data?.recentAccess ?? [];
  if (recent.length === 0) return null;
  const last = recent.slice(0, 3);
  return (
    <p className="text-xs text-ink-faint">
      Logins last shown:{' '}
      {last.map((a, i) => (
        <span key={`${a.credentialId}-${a.revealedAt}`}>
          {i > 0 && ', '}
          {a.userName ?? 'someone'} ({formatDate(a.revealedAt)})
        </span>
      ))}
      {recent.length > last.length && ` and ${recent.length - last.length} more`}
    </p>
  );
}

/** One registration's GST login on its own (the filing drawer). */
export function RegistrationLogin({
  registrationId,
}: {
  registrationId: string;
}): JSX.Element | null {
  const logins = useCredentials({ registrationId });
  if (!logins.data) return null;
  return (
    <PortalLogin
      registrationId={registrationId}
      credential={logins.data.items[0]}
      vaultReady={logins.data.vaultReady}
    />
  );
}
