'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { PERMISSION } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import type { OfficeRow } from '@/lib/types';
import { Button, Badge, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
import { DataTable } from '@/components/data-table';
import type { ColumnDef } from '@tanstack/react-table';

export function OfficesSection(): JSX.Element {
  const { principal } = useAuth();
  const mayManage = can(principal, PERMISSION.officeManage);
  const [editing, setEditing] = useState<OfficeRow | null>(null);
  const [creating, setCreating] = useState(false);

  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });

  const columns = useMemo<ColumnDef<OfficeRow, unknown>[]>(
    () => [
      { header: 'Code', accessorKey: 'code' },
      { header: 'Name', accessorKey: 'name' },
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
              cell: ({ row }: { row: { original: OfficeRow } }) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing(row.original)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ),
            } as ColumnDef<OfficeRow, unknown>,
          ]
        : []),
    ],
    [mayManage],
  );

  if (offices.isLoading) return <Spinner label="Loading offices…" />;

  return (
    <div className="space-y-3">
      {mayManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New office
          </Button>
        </div>
      )}
      <DataTable columns={columns} data={offices.data ?? []} empty="No offices." />

      {creating && <OfficeFormModal onClose={() => setCreating(false)} />}
      {editing && <OfficeFormModal office={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OfficeFormModal({
  office,
  onClose,
}: {
  office?: OfficeRow;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!office;

  const [code, setCode] = useState(office?.code ?? '');
  const [name, setName] = useState(office?.name ?? '');
  const [isActive, setIsActive] = useState(office?.isActive ?? true);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['admin', 'offices'] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch<OfficeRow>('/offices', {
        method: 'POST',
        body: { code: code.trim().toUpperCase(), name: name.trim() },
      }),
    onSuccess: () => {
      toast('Office created.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the office.', 'error'),
  });

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== office!.name) patch.name = name.trim();
      if (isActive !== office!.isActive) patch.isActive = isActive;
      return apiFetch(`/offices/${office!.id}`, { method: 'PATCH', body: patch });
    },
    onSuccess: () => {
      toast('Office updated.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the office.', 'error'),
  });

  const pending = create.isPending || save.isPending;
  const canSubmit = isEdit
    ? name.trim().length > 0
    : /^[A-Z0-9_-]{2,20}$/.test(code.trim().toUpperCase()) && name.trim().length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit office' : 'New office'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || pending} onClick={() => (isEdit ? save.mutate() : create.mutate())}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create office'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Code" required hint="2–20 chars: A–Z, 0–9, - or _. Cannot be changed later.">
          <Input
            value={code}
            disabled={isEdit}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="WEST"
          />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mumbai (West)" />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}
      </div>
    </Modal>
  );
}
