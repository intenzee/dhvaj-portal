'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, X } from 'lucide-react';
import { TEAM_ROLES, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EmployeeRow, EngagementDetail, EngagementLeadRow, TeamMember } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

type LeadRole = 'partner' | 'manager';

const LEAD_LABEL: Record<LeadRole, string> = {
  partner: 'Engagement Partner',
  manager: 'Manager',
};

/**
 * The partner and manager. The Managing Partner or an administrator changes
 * either; the Engagement Partner changes the manager while the engagement is open.
 */
export function LeadsCard({
  engagement: e,
  canChangePartner,
  canChangeManager,
}: {
  engagement: Pick<
    EngagementDetail,
    | 'id'
    | 'version'
    | 'engagementPartnerId'
    | 'engagementPartnerName'
    | 'engagementManagerId'
    | 'engagementManagerName'
  >;
  canChangePartner: boolean;
  canChangeManager: boolean;
}): JSX.Element {
  const [changing, setChanging] = useState<LeadRole | null>(null);
  const canChange: Record<LeadRole, boolean> = {
    partner: canChangePartner,
    manager: canChangeManager,
  };
  const rows: { role: LeadRole; name: string | null }[] = [
    { role: 'partner', name: e.engagementPartnerName },
    { role: 'manager', name: e.engagementManagerName },
  ];
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Leads</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        {rows.map(({ role, name }) => (
          <div key={role} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-ink-muted">{LEAD_LABEL[role]}</span>
            <div className="flex items-center gap-2">
              <span className={name ? 'text-ink' : 'text-ink-faint'}>{name ?? 'Not set'}</span>
              {canChange[role] && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Change ${LEAD_LABEL[role]}`}
                  onClick={() => setChanging(role)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Change
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardBody>
      {changing && (
        <ChangeLeadModal engagement={e} role={changing} onClose={() => setChanging(null)} />
      )}
    </Card>
  );
}

function ChangeLeadModal({
  engagement: e,
  role,
  onClose,
}: {
  engagement: Pick<
    EngagementDetail,
    'id' | 'version' | 'engagementPartnerId' | 'engagementManagerId'
  >;
  role: LeadRole;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const current = role === 'partner' ? e.engagementPartnerId : e.engagementManagerId;
  const leads = useQuery({
    queryKey: ['employees', 'leads'],
    queryFn: () => apiFetch<EngagementLeadRow[]>('/employees/leads'),
  });
  const options = (leads.data ?? []).filter(
    (p) => p.id !== current && (role === 'manager' || p.isPartner),
  );
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${e.id}/reassign-${role}`, {
        method: 'POST',
        body: {
          ...(role === 'partner'
            ? { engagementPartnerEmployeeId: employeeId }
            : { engagementManagerEmployeeId: employeeId }),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          version: e.version,
        },
      }),
    onSuccess: () => {
      toast(`${LEAD_LABEL[role]} changed.`);
      void qc.invalidateQueries({ queryKey: ['engagement', e.id] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not make the change.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change ${LEAD_LABEL[role]}`}
      description="The change is recorded in the audit trail."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!employeeId || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Change'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={`New ${LEAD_LABEL[role]}`} required>
          <Select value={employeeId} onChange={(ev) => setEmployeeId(ev.target.value)}>
            <option value="">Select a person…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} — {p.gradeName} ({p.officeCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function TeamSection({
  engagementId,
  team,
  canChange,
  leads,
}: {
  engagementId: string;
  team: TeamMember[];
  /** Managing Partner or administrator, or (while it is open) the engagement's EP or manager. */
  canChange: boolean;
  /** The partner and manager are changed on the Leads card, never removed here. */
  leads?: Pick<
    EngagementDetail,
    | 'engagementPartnerId'
    | 'engagementPartnerName'
    | 'engagementManagerId'
    | 'engagementManagerName'
  >;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState<string>('member');
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
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
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add member.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (empId: string) =>
      apiFetch(`/engagements/${engagementId}/team/${empId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Team member removed.');
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove member.', 'error'),
  });

  const leadIds = new Set([leads?.engagementPartnerId, leads?.engagementManagerId].filter(Boolean));
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
        {canChange && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-2">
        {team.length === 0 && <p className="text-sm text-ink-faint">No team assigned yet.</p>}
        {team.map((m) => {
          const openTasks = m.openTaskCount ?? 0;
          const isLead = leadIds.has(m.employeeId);
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words text-ink">{m.employeeName}</span>
              <div className="flex shrink-0 items-center gap-2">
                {openTasks > 0 && (
                  <span
                    className="text-xs text-ink-muted"
                    title="Open tasks they do or review here"
                  >
                    {openTasks} open
                  </span>
                )}
                <Badge>{humanize(m.roleOnEngagement)}</Badge>
                {canChange && !isLead && (
                  <button
                    onClick={() => (openTasks > 0 ? setRemoving(m) : remove.mutate(m.employeeId))}
                    disabled={remove.isPending}
                    className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                    aria-label={`Remove ${m.employeeName}`}
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type a name…"
            />
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

      {removing && (
        <HandOverModal
          engagementId={engagementId}
          member={removing}
          team={team}
          leads={leads}
          onClose={() => setRemoving(null)}
          onDone={invalidate}
        />
      )}
    </Card>
  );
}

/** Removing someone with open tasks: pick who takes them over, then remove. */
function HandOverModal({
  engagementId,
  member,
  team,
  leads,
  onClose,
  onDone,
}: {
  engagementId: string;
  member: TeamMember;
  team: TeamMember[];
  leads?: Pick<
    EngagementDetail,
    | 'engagementPartnerId'
    | 'engagementPartnerName'
    | 'engagementManagerId'
    | 'engagementManagerName'
  >;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const [to, setTo] = useState('');
  const n = member.openTaskCount ?? 0;
  const people = new Map<string, string>();
  if (leads?.engagementPartnerId)
    people.set(
      leads.engagementPartnerId,
      `${leads.engagementPartnerName ?? 'Partner'} — Engagement Partner`,
    );
  if (leads?.engagementManagerId)
    people.set(leads.engagementManagerId, `${leads.engagementManagerName ?? 'Manager'} — Manager`);
  for (const m of team) if (!people.has(m.employeeId)) people.set(m.employeeId, m.employeeName);
  people.delete(member.employeeId);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(
        `/engagements/${engagementId}/team/${member.employeeId}?handoverTo=${encodeURIComponent(to)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      toast(`${member.employeeName} removed; their tasks were handed over.`);
      onDone();
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove member.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Remove ${member.employeeName}`}
      description={`${member.employeeName} has ${n} open task${n === 1 ? '' : 's'} here, to do or to review. Choose who takes ${n === 1 ? 'it' : 'them'} over.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!to || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Removing…' : 'Hand over and remove'}
          </Button>
        </>
      }
    >
      <Field label="Hand the open tasks to" required>
        <Select value={to} onChange={(ev) => setTo(ev.target.value)}>
          <option value="">Select a person…</option>
          {[...people].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
