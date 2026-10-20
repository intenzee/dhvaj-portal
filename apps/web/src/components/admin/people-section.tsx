'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import {
  EMPLOYMENT_STATUSES,
  GRADE,
  PERMISSION,
  type EmploymentStatus,
  type GradeSlug,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import type { AdminEmployeeRow, AdminUserRow, OfficeRow } from '@/lib/types';
import { Button, Badge, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import type { ColumnDef } from '@tanstack/react-table';

const PAGE_SIZE = 25;

const GRADE_LABEL: Record<GradeSlug, string> = {
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article Assistant',
};

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  exited: 'Exited',
};

/**
 * Administration → People: the firm's employee records. An employee is who
 * someone is in the firm (grade, office, partner details); the linked portal
 * user is how they sign in. Engagement teams, sign-offs and partner lists all
 * read the employee record.
 */
export function PeopleSection(): JSX.Element {
  const { principal } = useAuth();
  const mayManage = can(principal, PERMISSION.employeeManage);
  const [editing, setEditing] = useState<AdminEmployeeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [offset, setOffset] = useState(0);

  const employees = useQuery({
    queryKey: ['admin', 'employees', offset],
    queryFn: () =>
      apiFetch<Paginated<AdminEmployeeRow>>(`/employees?limit=${PAGE_SIZE}&offset=${offset}`),
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const users = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: () => apiFetch<Paginated<AdminUserRow>>('/users?limit=100'),
    enabled: mayManage,
  });

  const columns = useMemo<ColumnDef<AdminEmployeeRow, unknown>[]>(
    () => [
      {
        header: 'Employee',
        cell: ({ row }) => (
          <div>
            <span className="block font-medium text-ink">{row.original.fullName}</span>
            <span className="block text-xs text-ink-faint">{row.original.employeeCode}</span>
          </div>
        ),
      },
      {
        header: 'Grade',
        cell: ({ row }) => (
          <div>
            <span className="block">{row.original.gradeName}</span>
            {row.original.membershipNo && (
              <span className="block text-xs text-ink-faint">M. No. {row.original.membershipNo}</span>
            )}
          </div>
        ),
      },
      { header: 'Office', accessorKey: 'officeCode' },
      {
        header: 'Portal login',
        cell: ({ row }) =>
          row.original.userEmail ? (
            <span className="text-sm">{row.original.userEmail}</span>
          ) : (
            <span className="text-xs text-ink-faint">Not linked</span>
          ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <Badge tone={row.original.employmentStatus === 'exited' ? 'danger' : 'success'}>
            {STATUS_LABEL[row.original.employmentStatus]}
          </Badge>
        ),
      },
      ...(mayManage
        ? [
            {
              header: '',
              id: 'actions',
              cell: ({ row }: { row: { original: AdminEmployeeRow } }) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing(row.original)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ),
            } as ColumnDef<AdminEmployeeRow, unknown>,
          ]
        : []),
    ],
    [mayManage],
  );

  if (employees.isLoading || offices.isLoading) return <Spinner label="Loading people…" />;

  return (
    <div className="space-y-3">
      {mayManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New employee
          </Button>
        </div>
      )}
      <DataTable columns={columns} data={employees.data?.items ?? []} empty="No employees yet." />
      {employees.data && (
        <Pagination
          total={employees.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="employees"
        />
      )}

      {creating && (
        <EmployeeFormModal
          offices={offices.data ?? []}
          users={users.data?.items ?? []}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <EmployeeFormModal
          offices={offices.data ?? []}
          users={users.data?.items ?? []}
          employee={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Create (no `employee`) or edit an employee record, its portal login and partner details. */
function EmployeeFormModal({
  offices,
  users,
  employee,
  onClose,
}: {
  offices: OfficeRow[];
  users: AdminUserRow[];
  employee?: AdminEmployeeRow;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!employee;

  const [employeeCode, setEmployeeCode] = useState(employee?.employeeCode ?? '');
  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [gradeSlug, setGradeSlug] = useState<GradeSlug>(
    (employee?.gradeSlug as GradeSlug | undefined) ?? GRADE.article,
  );
  const [officeCode, setOfficeCode] = useState(employee?.officeCode ?? offices[0]?.code ?? '');
  const [dateOfJoining, setDateOfJoining] = useState(employee?.dateOfJoining ?? '');
  const [userId, setUserId] = useState(employee?.userId ?? '');
  const [membershipNo, setMembershipNo] = useState(employee?.membershipNo ?? '');
  const [partnerSince, setPartnerSince] = useState(employee?.partnerSince ?? '');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(
    employee?.employmentStatus ?? 'active',
  );
  const [dateOfExit, setDateOfExit] = useState(employee?.dateOfExit ?? '');

  const isPartner = gradeSlug === GRADE.partner;

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch<AdminEmployeeRow>('/employees', {
        method: 'POST',
        body: {
          employeeCode: employeeCode.trim().toUpperCase(),
          fullName: fullName.trim(),
          gradeSlug,
          officeCode,
          dateOfJoining,
          ...(userId ? { userId } : {}),
          ...(isPartner && membershipNo.trim() ? { membershipNo: membershipNo.trim() } : {}),
          ...(isPartner && partnerSince ? { partnerSince } : {}),
        },
      }),
    onSuccess: () => {
      toast('Employee created.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the employee.', 'error'),
  });

  const save = useMutation({
    mutationFn: () => {
      // Only send what changed; `version` guards against a concurrent edit.
      const e = employee!;
      const patch: Record<string, unknown> = { version: e.version };
      if (fullName.trim() !== e.fullName) patch.fullName = fullName.trim();
      if (gradeSlug !== e.gradeSlug) patch.gradeSlug = gradeSlug;
      if (officeCode !== e.officeCode) patch.officeCode = officeCode;
      if (userId !== (e.userId ?? '')) patch.userId = userId || null;
      if (employmentStatus !== e.employmentStatus) patch.employmentStatus = employmentStatus;
      if (dateOfExit !== (e.dateOfExit ?? '')) patch.dateOfExit = dateOfExit || null;
      if (isPartner) {
        if (membershipNo.trim() !== (e.membershipNo ?? '')) patch.membershipNo = membershipNo.trim() || null;
        if (partnerSince !== (e.partnerSince ?? '')) patch.partnerSince = partnerSince || null;
      }
      return apiFetch(`/employees/${e.id}`, { method: 'PATCH', body: patch });
    },
    onSuccess: () => {
      toast('Employee updated.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the employee.', 'error'),
  });

  const pending = create.isPending || save.isPending;
  const canSubmit =
    fullName.trim().length > 0 &&
    officeCode.length > 0 &&
    (isEdit ||
      (/^[A-Z0-9_-]{2,20}$/.test(employeeCode.trim().toUpperCase()) && dateOfJoining.length > 0));

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit employee' : 'New employee'}
      description={
        isEdit ? `${employee!.fullName} (${employee!.employeeCode})` : 'Add someone to the firm.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || pending} onClick={() => (isEdit ? save.mutate() : create.mutate())}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee code" required hint="2–20 chars: A–Z, 0–9, - or _. Fixed once created.">
            <Input
              value={employeeCode}
              disabled={isEdit}
              onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
              placeholder="DA001"
            />
          </Field>
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Grade" required>
            <Select value={gradeSlug} onChange={(e) => setGradeSlug(e.target.value as GradeSlug)}>
              {Object.values(GRADE).map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Office" required>
            <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
              {offices.map((o) => (
                <option key={o.id} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of joining" required={!isEdit}>
            <Input
              type="date"
              value={dateOfJoining}
              disabled={isEdit}
              onChange={(e) => setDateOfJoining(e.target.value)}
            />
          </Field>
          <Field label="Portal login" hint="The user they sign in as. One user per employee.">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— Not linked —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {isPartner && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-line-strong p-3">
            <Field label="ICAI membership no." hint="Printed on reports the partner signs.">
              <Input value={membershipNo} onChange={(e) => setMembershipNo(e.target.value)} placeholder="512345" />
            </Field>
            <Field label="Partner since">
              <Input type="date" value={partnerSince} onChange={(e) => setPartnerSince(e.target.value)} />
            </Field>
          </div>
        )}

        {isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employment status">
              <Select
                value={employmentStatus}
                onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
              >
                {EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date of exit">
              <Input type="date" value={dateOfExit} onChange={(e) => setDateOfExit(e.target.value)} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
