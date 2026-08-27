'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { TEAM_ROLES, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EmployeeRow, TeamMember } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

export function TeamSection({
  engagementId,
  team,
}: {
  engagementId: string;
  team: TeamMember[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState<string>('member');

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=200'),
    enabled: open,
  });

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/team`, {
        method: 'POST',
        body: { employeeId, roleOnEngagement: role },
      }),
    onSuccess: () => {
      toast('Team member added.');
      invalidate();
      setOpen(false);
      setEmployeeId('');
      setFilter('');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add member.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (empId: string) =>
      apiFetch(`/engagements/${engagementId}/team/${empId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Team member removed.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not remove member.', 'error'),
  });

  const assignedIds = new Set(team.map((m) => m.employeeId));
  const options = (employees.data?.items ?? []).filter(
    (e) =>
      !assignedIds.has(e.id) &&
      (filter.trim() === '' || e.fullName.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Team ({team.length})</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </CardHeader>
      <CardBody className="space-y-2">
        {team.length === 0 && <p className="text-sm text-ink-faint">No team assigned yet.</p>}
        {team.map((m) => (
          <div key={m.id} className="flex items-center justify-between text-sm">
            <span className="text-ink">{m.employeeName}</span>
            <div className="flex items-center gap-2">
              <Badge>{humanize(m.roleOnEngagement)}</Badge>
              <button
                onClick={() => remove.mutate(m.employeeId)}
                disabled={remove.isPending}
                className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                aria-label={`Remove ${m.employeeName}`}
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </CardBody>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add team member"
        description="Only employees you can see are listed (RLS-scoped)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!employeeId || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Filter">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type a name…" />
          </Field>
          <Field label="Employee" required>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select an employee…</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} — {e.gradeName} ({e.officeCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role on engagement">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
