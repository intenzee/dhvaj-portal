'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
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
    [mayManage],
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
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Create (no `user`) or edit an existing user, including their role set. */
function UserFormModal({
  offices,
  user,
  onClose,
}: {
  offices: OfficeRow[];
  user?: AdminUserRow;
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

  const toggleRole = (r: RoleSlug): void =>
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch<AdminUserRow>('/users', {
        method: 'POST',
        body: { email: email.trim(), displayName: displayName.trim(), officeCode, mfaRequired, roles },
      }),
    onSuccess: () => {
      toast('User created.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the user.', 'error'),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Only send what changed, in two audited calls (profile, then roles).
      const patch: Record<string, unknown> = {};
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
  const canSubmit = isEdit
    ? displayName.trim().length > 0 && officeCode.length > 0
    : /.+@.+/.test(email) && displayName.trim().length > 0 && officeCode.length > 0;

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
        {!isEdit && (
          <Field label="Email" required hint="The login email. Must be unique.">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@hsdg.in"
            />
          </Field>
        )}
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
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 p-2">
            {ASSIGNABLE_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
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
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={mfaRequired} onChange={(e) => setMfaRequired(e.target.checked)} />
            Require multi-factor authentication
          </label>
        )}
      </div>
    </Modal>
  );
}
