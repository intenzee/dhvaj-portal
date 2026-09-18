'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  PERMISSION,
  type AuditTeamMember,
  type AuditTeamMemberDetail,
  type StatutoryAuditTeam,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Spinner, EmptyState } from '@/components/ui';
import { Input } from '@/components/form';

/**
 * Team — people + workload + time (Audit Spec §24, §37). One row per person on
 * the audit file: role, work items owned, planned hours (an allocation) and
 * actual hours (aggregated from the time-entry mechanism), plus whether they act
 * as a reviewer. Click a person to see their assigned areas, procedures, reviews
 * and time.
 */

const TEAM_QK = (id: string) => ['engagement', id, 'statutory-audit-team'];

export function TeamPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: TEAM_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditTeam[]>(`/engagements/${engagementId}/statutory-audit/team`),
  });

  if (query.isLoading) return <Spinner label="Loading team…" />;
  const team = query.data?.[0];
  if (!team) return null;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Team</h2>
        <p className="mt-1 text-xs text-ink-muted">
          EP: {team.engagementPartnerName ?? '—'} · Manager: {team.engagementManagerName ?? '—'}
        </p>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.8fr_0.8fr_0.6fr] gap-2 border-b border-line bg-surface-raised/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <span>Person</span>
          <span>Role</span>
          <span className="text-right">Work items</span>
          <span className="text-right">Planned hrs</span>
          <span className="text-right">Actual hrs</span>
          <span className="text-center">Review</span>
        </div>
        {team.members.length === 0 ? (
          <div className="p-5">
            <EmptyState>No one is assigned to this audit file yet.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {team.members.map((m) => (
              <MemberRow
                key={m.employeeId}
                engagementId={engagementId}
                workflowInstanceId={team.workflowInstanceId}
                member={m}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.8fr_0.8fr_0.6fr] gap-2 border-t border-line bg-surface-raised/40 px-4 py-2 text-xs font-semibold text-ink">
          <span>Total</span>
          <span />
          <span className="text-right">{team.totals.workItems}</span>
          <span className="text-right">{team.totals.plannedHours}</span>
          <span className="text-right">{team.totals.actualHours}</span>
          <span />
        </div>
      </Card>
    </div>
  );
}

function MemberRow({
  engagementId,
  workflowInstanceId,
  member,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  member: AuditTeamMember;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [planned, setPlanned] = useState(String(member.plannedHours));

  const detail = useQuery({
    queryKey: [...TEAM_QK(engagementId), 'member', member.employeeId],
    queryFn: () =>
      apiFetch<AuditTeamMemberDetail>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/team/${member.employeeId}`,
      ),
    enabled: open,
  });

  const setAllocation = useMutation({
    mutationFn: (plannedHours: number) =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/team/allocations`,
        { method: 'POST', body: { employeeId: member.employeeId, plannedHours } },
      ),
    onSuccess: () => {
      toast('Planned hours updated.');
      void qc.invalidateQueries({ queryKey: TEAM_QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not set planned hours.'),
  });

  const savePlanned = (): void => {
    const value = Number(planned);
    if (!Number.isFinite(value) || value < 0 || value === member.plannedHours) return;
    setAllocation.mutate(value);
  };

  return (
    <li>
      <div className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.8fr_0.8fr_0.6fr] items-center gap-2 px-4 py-2.5 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-left text-ink hover:text-primary-700"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
          )}
          <span className="truncate">{member.name}</span>
        </button>
        <span className="text-ink-muted">{member.role}</span>
        <span className="text-right tabular-nums text-ink">{member.workItems}</span>
        <span className="text-right tabular-nums">
          {canManage ? (
            <Input
              type="number"
              min={0}
              step="0.5"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              onBlur={savePlanned}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-7 w-20 text-right"
            />
          ) : (
            <span className="tabular-nums text-ink">{member.plannedHours}</span>
          )}
        </span>
        <span className="text-right tabular-nums text-ink">{member.actualHours}</span>
        <span className="text-center">
          <Badge tone={member.isReviewer ? 'info' : 'neutral'}>
            {member.isReviewer ? 'Yes' : 'No'}
          </Badge>
        </span>
      </div>

      {open && (
        <div className="border-t border-line bg-surface-sunken/20 px-4 py-3">
          {detail.isLoading && <Spinner label="Loading…" />}
          {detail.data && <MemberDetail detail={detail.data} />}
        </div>
      )}
    </li>
  );
}

function MemberDetail({ detail }: { detail: AuditTeamMemberDetail }): JSX.Element {
  return (
    <div className="space-y-3 text-sm">
      {detail.responsibility && (
        <p className="text-xs text-ink-muted">
          <span className="font-semibold text-ink">Responsibility:</span> {detail.responsibility}
        </p>
      )}
      <p className="text-xs text-ink-muted">
        Planned {detail.plannedHours} hrs · Actual {detail.actualHours} hrs · {detail.openReviewNotes}{' '}
        open review note(s)
      </p>
      <AssignmentList title="Audit areas" items={detail.ownedAreas} />
      <AssignmentList title="Procedures (preparer)" items={detail.ownedProcedures} />
      <AssignmentList title="Procedures (reviewer)" items={detail.reviewingProcedures} />
    </div>
  );
}

function AssignmentList({
  title,
  items,
}: {
  title: string;
  items: { id: string; ref: string | null; title: string; state: string }[];
}): JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">—</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 text-xs text-ink">
              {it.ref && <span className="font-mono text-ink-faint">{it.ref}</span>}
              <span className="truncate">{it.title}</span>
              <Badge tone="neutral">{humanize(it.state)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
