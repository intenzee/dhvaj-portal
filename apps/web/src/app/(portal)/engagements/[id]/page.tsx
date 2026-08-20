'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { EngagementDetail, MyTask, ComplianceRow, MyClientDependency } from '@/lib/types';
import {
  PageHeader,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  EmptyState,
} from '@/components/ui';
import { StatusBadge, PriorityBadge } from '@/components/status-badge';
import { LifecycleActions } from '@/components/actions/lifecycle-actions';
import { ReviewActions } from '@/components/actions/review-actions';
import { CreateTaskModal } from '@/components/actions/create-task-modal';
import { RequestDependencyModal } from '@/components/actions/request-dependency-modal';
import { TaskStatusControl } from '@/components/actions/task-status-control';
import { ClientDependencyActions } from '@/components/actions/client-dependency-actions';
import { TeamSection } from '@/components/actions/team-section';
import { DocumentsSection } from '@/components/actions/documents-section';
import { GenerateComplianceButton } from '@/components/actions/generate-compliance-button';

export default function EngagementDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const eng = useQuery({
    queryKey: ['engagement', id],
    queryFn: () => apiFetch<EngagementDetail>(`/engagements/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  const tasks = useQuery({
    queryKey: ['engagement', id, 'tasks'],
    queryFn: () => apiFetch<Paginated<MyTask>>(`/engagements/${id}/tasks?limit=50`),
  });
  const deps = useQuery({
    queryKey: ['engagement', id, 'client-dependencies'],
    queryFn: () => apiFetch<Paginated<MyClientDependency>>(`/engagements/${id}/client-dependencies?limit=50`),
  });
  const compliance = useQuery({
    queryKey: ['engagement', id, 'compliance'],
    queryFn: () => apiFetch<Paginated<ComplianceRow>>(`/engagements/${id}/compliance?limit=50`),
  });

  if (eng.isLoading) return <Spinner label="Loading engagement…" />;
  if (eng.isError || !eng.data)
    return <EmptyState>Engagement not found, or you don&rsquo;t have access to it.</EmptyState>;

  const e = eng.data;

  return (
    <div>
      <PageHeader
        title={`${e.engagementCode} · ${e.entityName}`}
        subtitle={`${e.serviceName} · ${e.financialYear} ${e.periodLabel} · ${e.officeCode}`}
        actions={
          <Link
            href={`/entities/${e.entityId}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50"
          >
            Client 360 →
          </Link>
        }
      />

      {/* Action bar */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Status</span>
            <StatusBadge status={e.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReviewActions engagement={e} />
            <LifecycleActions engagement={e} />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
            <Fact label="Engagement Partner" value={e.engagementPartnerName} />
            <Fact label="Manager" value={e.engagementManagerName} />
            <Fact label="Review model" value={e.effectiveReviewModel.name} />
            <Fact label="Signed off" value={e.isSignedOff ? (e.signedOffByName ?? 'Yes') : 'No'} />
            <Fact label="Open review points" value={String(e.openReviewPointCount)} />
            <Fact label="Open tasks" value={String(e.openTaskCount)} />
          </CardBody>
          <CardBody className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {e.isWaitingForClient && <Badge tone="warn">Waiting for client</Badge>}
            {e.internallyOverdueTaskCount > 0 && (
              <Badge tone="danger">{e.internallyOverdueTaskCount} internally overdue</Badge>
            )}
            {e.clientOverdueCount > 0 && <Badge tone="danger">{e.clientOverdueCount} client overdue</Badge>}
            {e.effectiveReviewModel.requiresEpSignoff && !e.isSignedOff && (
              <Badge tone="info">EP sign-off required</Badge>
            )}
            {!e.isWaitingForClient &&
              e.internallyOverdueTaskCount === 0 &&
              e.clientOverdueCount === 0 && <Badge tone="success">On track</Badge>}
          </CardBody>
        </Card>

        <TeamSection engagementId={e.id} team={e.team} />
      </div>

      {/* Tasks */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Tasks</h2>
          <CreateTaskModal engagementId={e.id} team={e.team} />
        </div>
        <Card className="overflow-hidden p-0">
          {tasks.data && tasks.data.items.length === 0 && (
            <div className="p-5"><EmptyState>No tasks on this engagement yet.</EmptyState></div>
          )}
          {tasks.data && tasks.data.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Task</th>
                  <th className="px-4 py-2.5 font-semibold">Assignee</th>
                  <th className="px-4 py-2.5 font-semibold">Priority</th>
                  <th className="px-4 py-2.5 font-semibold">Due</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.data.items.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{t.title}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{t.assignedToName ?? 'Unassigned'}</td>
                    <td className="px-4 py-2.5"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-2.5 text-ink-muted">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                    <td className="px-4 py-2.5"><TaskStatusControl task={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* Client dependencies */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Client dependencies</h2>
          <RequestDependencyModal engagementId={e.id} />
        </div>
        <Card className="overflow-hidden p-0">
          {deps.data && deps.data.items.length === 0 && (
            <div className="p-5"><EmptyState>No information requested from the client.</EmptyState></div>
          )}
          {deps.data && deps.data.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Requested</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Escalation</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {deps.data.items.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{d.requestedInfo}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {d.escalationDate ? formatDate(d.escalationDate) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right"><ClientDependencyActions dep={d} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* Documents */}
      <DocumentsSection engagementId={e.id} />

      {/* Compliance */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Compliance obligations</h2>
          <GenerateComplianceButton engagementId={e.id} />
        </div>
        <Card className="overflow-hidden p-0">
          {compliance.data && compliance.data.items.length === 0 && (
            <div className="p-5"><EmptyState>No compliance obligations generated.</EmptyState></div>
          )}
          {compliance.data && compliance.data.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-semibold">Obligation</th>
                  <th className="px-4 py-2.5 font-semibold">Statutory</th>
                  <th className="px-4 py-2.5 font-semibold">Internal SLA</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {compliance.data.items.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{c.complianceRuleName}</td>
                    <td className={`px-4 py-2.5 ${c.isStatutoryOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}`}>
                      {formatDate(c.effectiveStatutoryDeadline)}
                    </td>
                    <td className={`px-4 py-2.5 ${c.isInternallyOverdue ? 'font-medium text-warning-700' : 'text-ink-muted'}`}>
                      {formatDate(c.effectiveInternalSlaDate)}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-ink">{value ?? '—'}</div>
    </div>
  );
}
