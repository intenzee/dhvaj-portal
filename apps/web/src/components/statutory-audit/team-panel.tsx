'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, Shuffle, Sparkles } from 'lucide-react';
import {
  PERMISSION,
  type AuditTeamMember,
  type AuditTeamMemberDetail,
  type StatutoryAuditTeam,
  type TeamBalanceMove,
  type TeamBalanceResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Input } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

/**
 * Team — people + workload + time (Audit Spec §24, §37). One row per person on
 * the audit file: role, work items owned, planned hours (an allocation) and
 * actual hours (aggregated from the time-entry mechanism), plus whether they act
 * as a reviewer. Click a person to open their assigned areas, procedures,
 * reviews and time in a pop-up.
 *
 * Team plans itself from the file: planned hours start as the estimate from
 * the work each person owns and reviews (until someone sets them), "Balance
 * the work" hands the manager's not-started procedures to the team by grade
 * and load, and each person's flags say what needs attention.
 */

const FLAG_TONE: Record<string, string> = { info: 'info', warn: 'warn', danger: 'danger' };

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
        {(team.unassigned ?? 0) > 0 && (
          <p className="mt-1 text-xs text-warning-700">
            {team.unassigned} procedure(s) have no owner.
          </p>
        )}
      </Card>

      {/* Older API builds send no balance proposal. */}
      {(team.balance ?? []).length > 0 && (
        <BalanceCard
          engagementId={engagementId}
          workflowInstanceId={team.workflowInstanceId}
          moves={team.balance}
          canManage={canManage}
        />
      )}

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
  // Estimated hours move with the file — follow them.
  useEffect(() => setPlanned(String(member.plannedHours)), [member.plannedHours]);
  const flags = member.flags ?? [];

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
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="group flex items-center gap-1.5 text-left text-ink hover:text-primary-700"
          title={open ? "Collapse this person's work" : "Open this person's work"}
        >
          <ExpandToggle open={open} />
          <span className="min-w-0">
            <span className="block truncate">{member.name}</span>
            {flags.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-1">
                {flags.map((f) => (
                  <Badge key={f.key} tone={FLAG_TONE[f.tone]}>
                    {f.label}
                  </Badge>
                ))}
              </span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
        <span className="text-ink-muted">
          {member.role}
          {member.grade && member.grade !== member.role && (
            <span className="block text-[11px] text-ink-faint">{member.grade}</span>
          )}
        </span>
        <span className="text-right tabular-nums text-ink">
          {member.workItems}
          {member.progress && member.progress.total > 0 && (
            <span className="block text-[11px] text-ink-faint">
              {member.progress.done}/{member.progress.total} done
            </span>
          )}
        </span>
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
              aria-label={`Planned hours for ${member.name}`}
            />
          ) : (
            <span className="tabular-nums text-ink">{member.plannedHours}</span>
          )}
          {member.plannedSuggested ? (
            <span
              className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-ink-faint"
              title={member.planBasis ?? undefined}
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              Estimated
            </span>
          ) : (
            member.estimatedHours > 0 &&
            member.estimatedHours !== member.plannedHours && (
              <span className="mt-0.5 block text-[11px] text-ink-faint" title={member.planBasis ?? undefined}>
                File suggests {member.estimatedHours}h
                {canManage && (
                  <button
                    type="button"
                    className="ml-1 text-primary-600 hover:underline"
                    onClick={() => setAllocation.mutate(member.estimatedHours)}
                  >
                    Use
                  </button>
                )}
              </span>
            )
          )}
        </span>
        <span className="text-right tabular-nums text-ink">{member.actualHours}</span>
        <span className="text-center">
          <Badge tone={member.isReviewer ? 'info' : 'neutral'}>
            {member.isReviewer ? 'Yes' : 'No'}
          </Badge>
        </span>
      </div>

      <InlinePanel
        className="mx-4 mb-3"
        open={open}
        onClose={() => setOpen(false)}
        title={member.name}
        description={`${member.role} · Team`}
        size="lg"
      >
        {detail.isLoading && <Spinner label="Loading…" />}
        {detail.data && <MemberDetail detail={detail.data} />}
      </InlinePanel>
    </li>
  );
}

/**
 * "Balance the work": the proposed owner / reviewer changes, applied in one
 * click — the manager's not-started procedures go to the team by grade and
 * load; the EP reviews significant risks, the manager the rest.
 */
function BalanceCard({
  engagementId,
  workflowInstanceId,
  moves,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  moves: TeamBalanceMove[];
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [showing, setShowing] = useState(false);
  const owners = moves.filter((m) => m.field === 'owner');
  const reviewers = moves.filter((m) => m.field === 'reviewer');
  const apply = useMutation({
    mutationFn: () =>
      apiFetch<TeamBalanceResult>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/team/balance`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (r) => {
      toast(`Work balanced — ${r.moved} change(s) made.`);
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not balance the work.'),
  });
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Shuffle className="h-4 w-4" aria-hidden />
            Balance the work
          </h3>
          <p className="text-xs text-ink-muted">
            {[
              owners.length > 0 && `${owners.length} procedure(s) can move to the team`,
              reviewers.length > 0 && `${reviewers.length} review(s) to route`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowing((v) => !v)}>
            {showing ? 'Hide changes' : 'See changes'}
          </Button>
          {canManage && (
            <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate()}>
              Apply all
            </Button>
          )}
        </div>
      </div>
      {showing && (
        <ul className="divide-y divide-line rounded-lg border border-line text-xs">
          {moves.map((m) => (
            <li key={`${m.procedureId}:${m.field}`} className="px-3 py-1.5">
              <span className="font-mono text-ink-faint">{m.ref}</span>{' '}
              <span className="text-ink">{m.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-ink-muted">
                {m.field === 'owner' ? 'Preparer' : 'Reviewer'}: {m.fromName ?? 'no one'}
                <ArrowRight className="h-3 w-3" aria-hidden />
                <span className="font-medium text-ink">{m.toName}</span>
                <span className="text-ink-faint">— {m.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
