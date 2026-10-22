'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Pencil } from 'lucide-react';
import { PERMISSION, type Paginated, type StartExitResult } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { formatDate, humanize } from '@/lib/format';
import { istToday } from '@/lib/people';
import type { AdminEmployeeRow, AdminUserRow, OfficeRow } from '@/lib/types';
import { EmployeeFormModal } from '@/components/admin/people-section';
import { Modal } from '@/components/modal';
import { Field, Input, Textarea } from '@/components/form';
import { Badge, Button, Card, CardBody } from '@/components/ui';

/** Who the person is in the firm, and the exit flow (spec §4.2). */
export function ProfileTab({ employee }: { employee: AdminEmployeeRow }): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const mayManage = can(principal, PERMISSION.employeeManage);
  const [editing, setEditing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: editing,
  });
  const users = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: () => apiFetch<Paginated<AdminUserRow>>('/users?limit=100'),
    enabled: editing && can(principal, PERMISSION.userRead),
  });

  const rows: Array<[string, string]> = [
    ['Employee code', employee.employeeCode],
    ['Grade', employee.gradeName],
    ['Office', employee.officeCode],
    ['Date of joining', formatDate(employee.dateOfJoining)],
    ['Status', humanize(employee.employmentStatus)],
    ['Date of exit', formatDate(employee.dateOfExit)],
  ];
  if (employee.isPartner) {
    rows.push(['ICAI membership no.', employee.membershipNo ?? '—']);
    rows.push(['Partner since', formatDate(employee.partnerSince)]);
  }

  return (
    <Card>
      <CardBody>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-medium text-ink-faint">{k}</dt>
              <dd className="text-sm text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {mayManage && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {employee.employmentStatus !== 'exited' && (
              <Button size="sm" variant="secondary" onClick={() => setExiting(true)}>
                <LogOut className="h-3.5 w-3.5" /> Record an exit
              </Button>
            )}
          </div>
        )}
      </CardBody>
      {editing && offices.data && (
        <EmployeeFormModal
          offices={offices.data}
          users={users.data?.items ?? []}
          employee={employee}
          onClose={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: ['people', 'employee', employee.id] });
          }}
        />
      )}
      {exiting && <ExitModal employee={employee} onClose={() => setExiting(false)} />}
    </Card>
  );
}

function ExitModal({
  employee,
  onClose,
}: {
  employee: AdminEmployeeRow;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [dateOfExit, setDateOfExit] = useState(employee.dateOfExit ?? '');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<StartExitResult | null>(null);
  const today = istToday();

  const exit = useMutation({
    mutationFn: () =>
      apiFetch<StartExitResult>(`/people/employees/${employee.id}/exit`, {
        method: 'POST',
        body: {
          dateOfExit,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          version: employee.version,
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['people'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not record the exit.', 'error'),
  });

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Exit recorded"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-2 text-sm">
          <p>
            {employee.fullName} leaves on <strong>{formatDate(result.dateOfExit)}</strong>.
          </p>
          <p>
            {result.loginTurnedOff ? (
              <Badge tone="success">Login switched off now</Badge>
            ) : (
              'Their login goes off on that day, and their password is removed.'
            )}
          </p>
          {result.reassignAskedOf.length > 0 && (
            <p>Asked to reassign their work: {result.reassignAskedOf.join(', ')}.</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record an exit"
      description={`${employee.fullName} (${employee.employeeCode})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!dateOfExit || exit.isPending} onClick={() => exit.mutate()}>
            {exit.isPending ? 'Saving…' : 'Record exit'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Last working day"
          required
          hint={
            dateOfExit && dateOfExit <= today
              ? 'Today or past: the login goes off now.'
              : 'Until then they are on notice; the login goes off on this day.'
          }
        >
          <Input type="date" value={dateOfExit} onChange={(e) => setDateOfExit(e.target.value)} />
        </Field>
        <Field label="Reason" hint="Kept on the audit trail only.">
          <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-muted">
          The engagement partners on their work and their reporting manager are asked to reassign
          it.
        </p>
      </div>
    </Modal>
  );
}
