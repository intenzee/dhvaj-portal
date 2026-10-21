'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus } from 'lucide-react';
import { ASSIGNABLE_ROLES, PERMISSION, type Paginated, type RoleSlug } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can, roleLabel } from '@/lib/principal';
import type { AdminUserRow, OfficeRow } from '@/lib/types';
import { Button, Badge, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import type { ColumnDef } from '@tanstack/react-table';

const PAGE_SIZE = 25;

/** GET /user-passwords: users with a portal password (absent = Microsoft only). */
export type PasswordStatuses = Record<string, { mustChange: boolean; locked: boolean }>;
export const PASSWORDS_KEY = ['admin', 'user-passwords'];

export function SignInBadge({ status }: { status?: PasswordStatuses[string] }): JSX.Element {
  if (!status) return <Badge>Microsoft only</Badge>;
  if (status.locked) return <Badge tone="danger">Locked</Badge>;
  if (status.mustChange) return <Badge tone="warn">Temporary password</Badge>;
  return <Badge tone="success">Password</Badge>;
}

export function UsersSection(): JSX.Element {
  const { principal } = useAuth();
  const mayManage = can(principal, PERMISSION.userManage);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [offset, setOffset] = useState(0);

  const users = useQuery({
    queryKey: ['admin', 'users', offset],
    queryFn: () => apiFetch<Paginated<AdminUserRow>>(`/users?limit=${PAGE_SIZE}&offset=${offset}`),
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const passwords = useQuery({
    queryKey: PASSWORDS_KEY,
    queryFn: () => apiFetch<PasswordStatuses>('/user-passwords'),
    enabled: mayManage,
  });
  const statuses = passwords.data;

  const columns = useMemo<ColumnDef<AdminUserRow, unknown>[]>(
    () => [
      {
        header: 'User',
        cell: ({ row }) => (
          <div>
            <span className="block font-medium text-ink">{row.original.displayName}</span>
            <span className="block text-xs text-ink-faint">{row.original.email}</span>
          </div>
        ),
      },
      { header: 'Office', accessorKey: 'officeCode' },
      {
        header: 'Roles',
        cell: ({ row }) =>
          row.original.roles.length === 0 ? (
            <span className="text-xs text-ink-faint">No role</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.map((r) => (
                <Badge key={r} tone="info">
                  {roleLabel(r)}
                </Badge>
              ))}
            </div>
          ),
      },
      {
        header: 'Status',
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="danger">Inactive</Badge>
          ),
      },
      ...(mayManage
        ? [
            {
              header: 'Sign-in',
              id: 'sign-in',
              cell: ({ row }: { row: { original: AdminUserRow } }) => (
                <SignInBadge status={statuses?.[row.original.id]} />
              ),
            } as ColumnDef<AdminUserRow, unknown>,
            {
              header: '',
              id: 'actions',
              cell: ({ row }: { row: { original: AdminUserRow } }) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing(row.original)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ),
            } as ColumnDef<AdminUserRow, unknown>,
          ]
        : []),
    ],
    [mayManage, statuses],
  );

  if (users.isLoading || offices.isLoading) return <Spinner label="Loading users…" />;

  return (
    <div className="space-y-3">
      {mayManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New user
          </Button>
        </div>
      )}
      <DataTable columns={columns} data={users.data?.items ?? []} empty="No users in your scope." />
      {users.data && (
        <Pagination
          total={users.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="users"
        />
      )}

      {creating && (
        <UserFormModal offices={offices.data ?? []} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <UserFormModal
          offices={offices.data ?? []}
          user={editing}
          passwordStatus={statuses?.[editing.id]}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * The temporary password, shown once right after it is made. The admin hands
 * it over; the person must choose their own at first sign-in.
 */
export function TemporaryPasswordPanel({ email, password }: { email: string; password: string }): JSX.Element {
  const toast = useToast();
  const site = typeof window === 'undefined' ? '' : window.location.origin;
  const copy = async (): Promise<void> => {
    const text = `Portal: ${site}\nEmail: ${email}\nTemporary password: ${password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Sign-in details copied.');
    } catch {
      toast('Could not copy — select the password and copy it by hand.', 'error');
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-success-500/30 bg-success-50 p-3 text-sm">
      <p className="font-medium text-ink">Give these sign-in details to the person:</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Portal</dt>
        <dd className="text-ink">{site}</dd>
        <dt className="text-ink-muted">Email</dt>
        <dd className="text-ink">{email}</dd>
        <dt className="text-ink-muted">Temporary password</dt>
        <dd>
          <code data-testid="temporary-password" className="select-all font-mono text-base font-semibold text-ink">
            {password}
          </code>
        </dd>
      </dl>
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        <Copy className="h-3.5 w-3.5" /> Copy sign-in details
      </Button>
      <p className="text-xs text-ink-muted">
        It is shown only this once. At first sign-in they must choose their own password. If it is
        lost, use Reset password.
      </p>
    </div>
  );
}

/**
 * Create (no `user`) or edit an existing user, including their role set and
 * their portal password (give, reset, or turn off).
 */
function UserFormModal({
  offices,
  user,
  passwordStatus,
  onClose,
}: {
  offices: OfficeRow[];
  user?: AdminUserRow;
  passwordStatus?: PasswordStatuses[string];
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!user;

  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [officeCode, setOfficeCode] = useState(user?.officeCode ?? offices[0]?.code ?? '');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [roles, setRoles] = useState<RoleSlug[]>(user?.roles ?? []);
  // A user who must use MFA signs in with Microsoft only; the API refuses a password.
  const [givePassword, setGivePassword] = useState(true);
  // The temporary password just made, shown once in place of the form.
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const toggleRole = (r: RoleSlug): void =>
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    qc.invalidateQueries({ queryKey: PASSWORDS_KEY });
  };

  const issueTemporary = (userId: string) =>
    apiFetch<{ temporaryPassword: string }>(`/users/${userId}/password`, { method: 'POST' });

  const create = useMutation({
    mutationFn: async () => {
      const created = await apiFetch<AdminUserRow>('/users', {
        method: 'POST',
        body: { email: email.trim(), displayName: displayName.trim(), officeCode, mfaRequired, roles },
      });
      if (!givePassword || mfaRequired) return { created, temporaryPassword: null };
      try {
        const { temporaryPassword } = await issueTemporary(created.id);
        return { created, temporaryPassword };
      } catch {
        // The user exists; the password can be given from Edit.
        return { created, temporaryPassword: null, passwordFailed: true };
      }
    },
    onSuccess: (res) => {
      invalidate();
      if ('passwordFailed' in res) {
        toast('User created, but the password was not set. Open Edit → Give a portal password.', 'error');
        onClose();
      } else if (res.temporaryPassword) {
        toast('User created.');
        setIssued({ email: res.created.email, password: res.temporaryPassword });
      } else {
        toast('User created.');
        onClose();
      }
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the user.', 'error'),
  });

  const resetPassword = useMutation({
    mutationFn: () => issueTemporary(user!.id),
    onSuccess: (res) => {
      invalidate();
      setIssued({ email: user!.email, password: res.temporaryPassword });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not set the password.', 'error'),
  });

  const removePassword = useMutation({
    mutationFn: () => apiFetch(`/users/${user!.id}/password`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Password sign-in turned off. They can still sign in with Microsoft.');
      invalidate();
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not turn off password sign-in.', 'error'),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Only send what changed, in two audited calls (profile, then roles).
      const patch: Record<string, unknown> = {};
      if (email.trim().toLowerCase() !== user!.email.toLowerCase()) patch.email = email.trim();
      if (displayName.trim() !== user!.displayName) patch.displayName = displayName.trim();
      if (officeCode !== user!.officeCode) patch.officeCode = officeCode;
      if (isActive !== user!.isActive) patch.isActive = isActive;
      if (Object.keys(patch).length > 0) {
        await apiFetch(`/users/${user!.id}`, { method: 'PATCH', body: patch });
      }
      const changedRoles =
        roles.length !== user!.roles.length || roles.some((r) => !user!.roles.includes(r));
      if (changedRoles) {
        await apiFetch(`/users/${user!.id}/roles`, { method: 'PUT', body: { roles } });
      }
    },
    onSuccess: () => {
      toast('User updated.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the user.', 'error'),
  });

  const pending = create.isPending || save.isPending;
  const canSubmit = /.+@.+/.test(email) && displayName.trim().length > 0 && officeCode.length > 0;

  if (issued) {
    return (
      <Modal
        open
        onClose={onClose}
        title={isEdit ? 'New temporary password' : 'User created'}
        description={issued.email}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <TemporaryPasswordPanel email={issued.email} password={issued.password} />
      </Modal>
    );
  }

  const passwordBusy = resetPassword.isPending || removePassword.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'New user'}
      description={isEdit ? user!.email : 'Create a portal user and assign roles.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || pending} onClick={() => (isEdit ? save.mutate() : create.mutate())}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Email"
          required
          hint={
            isEdit
              ? 'Their sign-in email (and Microsoft sign-in name, if they use Microsoft). Changing it moves the login to the new address; roles, employee record and history stay.'
              : 'Their sign-in email (and Microsoft sign-in name, if they use Microsoft). Must be unique.'
          }
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@dhvaj.in"
          />
        </Field>
        <Field label="Display name" required>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Primary office" required>
          <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
            {offices.map((o) => (
              <option key={o.id} value={o.code}>
                {o.name} ({o.code})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Roles" hint="Determines what the user can see and do. May be empty (no access).">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-line-strong p-2">
            {ASSIGNABLE_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-raised">
                <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
                {roleLabel(r)}
              </label>
            ))}
          </div>
        </Field>

        {isEdit ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (uncheck to deactivate — the user is never deleted)
          </label>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={givePassword && !mfaRequired}
                disabled={mfaRequired}
                onChange={(e) => setGivePassword(e.target.checked)}
              />
              Give a portal password (email + password sign-in)
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={mfaRequired} onChange={(e) => setMfaRequired(e.target.checked)} />
              Require multi-factor authentication (Microsoft sign-in only)
            </label>
          </>
        )}

        {isEdit && (
          <div className="space-y-2 rounded-lg border border-line-strong p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <KeyRound className="h-4 w-4" /> Portal password
              </span>
              <SignInBadge status={passwordStatus} />
            </div>
            <p className="text-xs text-ink-muted">
              {passwordStatus?.locked
                ? 'Locked after 5 wrong passwords (lifts by itself after 15 minutes). A reset unlocks it now.'
                : passwordStatus
                  ? 'A reset makes a new temporary password and signs them out everywhere.'
                  : 'They have no portal password yet, so they can only sign in with Microsoft.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={passwordBusy}
                onClick={() => resetPassword.mutate()}
              >
                {passwordStatus ? 'Reset password' : 'Give a portal password'}
              </Button>
              {passwordStatus && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={passwordBusy}
                  onClick={() => removePassword.mutate()}
                >
                  Turn off password sign-in
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
