'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, humanize } from '@/lib/format';
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
import { ComponentsSection } from '@/components/actions/components-section';
import { ServicesSection } from '@/components/actions/services-section';
import { CoveredEntitiesSection } from '@/components/actions/covered-entities-section';
import { ComponentWorkSection } from '@/components/actions/component-work-section';
import { DocumentsSection } from '@/components/actions/documents-section';
import { InvoicesSection } from '@/components/actions/invoices-section';
import { NotesSection } from '@/components/actions/notes-section';
import { GenerateComplianceButton } from '@/components/actions/generate-compliance-button';
import { RecordEventButton } from '@/components/compliance/record-event-modal';
import { ObligationExtensionActions } from '@/components/compliance/extension-modals';
import { DeadlineLayersModal } from '@/components/compliance/deadline-layers-modal';

type TabKey =
  | 'overview'
  | 'services'
  | 'work'
  | 'compliance'
  | 'documents'
  | 'team'
  | 'activity'
  | 'invoices'
  | 'notes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'services', label: 'Services' },
  { key: 'work', label: 'Work' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'documents', label: 'Documents' },
  { key: 'team', label: 'Team' },
  { key: 'activity', label: 'Activity' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'notes', label: 'Notes' },
];

interface ActivityRecord {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorRole: string | null;
  reason: string | null;
  createdAt: string;
}

export default function EngagementDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabKey>('overview');
  const [deadlinesFor, setDeadlinesFor] = useState<ComplianceRow | null>(null);

  const eng = useQuery({
    queryKey: ['engagement', id],
    queryFn: () => apiFetch<EngagementDetail>(`/engagements/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  const tasks = useQuery({
    queryKey: ['engagement', id, 'tasks'],
    queryFn: () => apiFetch<Paginated<MyTask>>(`/engagements/${id}/tasks?limit=50`),
    enabled: tab === 'work',
  });
  const deps = useQuery({
    queryKey: ['engagement', id, 'client-dependencies'],
    queryFn: () =>
      apiFetch<Paginated<MyClientDependency>>(`/engagements/${id}/client-dependencies?limit=50`),
    enabled: tab === 'work',
  });
  const compliance = useQuery({
    queryKey: ['engagement', id, 'compliance'],
    queryFn: () => apiFetch<Paginated<ComplianceRow>>(`/engagements/${id}/compliance?limit=50`),
    enabled: tab === 'compliance',
  });
  const activity = useQuery({
    queryKey: ['engagement', id, 'lifecycle-history'],
    queryFn: () =>
      apiFetch<Paginated<ActivityRecord>>(`/engagements/${id}/lifecycle-history?limit=50`),
    enabled: tab === 'activity',
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
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised"
          >
            Client 360 →
          </Link>
        }
      />

      {/* Action bar — always visible */}
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Status
            </span>
            <StatusBadge status={e.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReviewActions engagement={e} />
            <LifecycleActions engagement={e} />
          </div>
        </CardBody>
      </Card>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line-strong">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-primary-600 text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <Card>
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
            <CardBody className="grid grid-cols-2 gap-y-3 border-t border-line text-sm sm:grid-cols-3">
              <Fact label="Type" value={humanize(e.engagementType)} />
              <Fact label="Priority" value={humanize(e.priority)} />
              <Fact label="Confidentiality" value={humanize(e.confidentiality)} />
              <Fact label="Billing model" value={e.billingModel ? humanize(e.billingModel) : '—'} />
              <Fact label="Currency" value={e.currency} />
              <Fact
                label="Mandate letter"
                value={
                  e.mandateLetterReference
                    ? `${e.mandateLetterReference}${e.mandateLetterDate ? ` · ${formatDate(e.mandateLetterDate)}` : ''}`
                    : '—'
                }
              />
            </CardBody>
            <CardBody className="flex flex-wrap gap-2 border-t border-line pt-3">
              {e.isWaitingForClient && <Badge tone="warn">Waiting for client</Badge>}
              {e.internallyOverdueTaskCount > 0 && (
                <Badge tone="danger">{e.internallyOverdueTaskCount} internally overdue</Badge>
              )}
              {e.clientOverdueCount > 0 && (
                <Badge tone="danger">{e.clientOverdueCount} client overdue</Badge>
              )}
              {e.effectiveReviewModel.requiresEpSignoff && !e.isSignedOff && (
                <Badge tone="info">EP sign-off required</Badge>
              )}
              {!e.isWaitingForClient &&
                e.internallyOverdueTaskCount === 0 &&
                e.clientOverdueCount === 0 && <Badge tone="success">On track</Badge>}
            </CardBody>
          </Card>
          <CoveredEntitiesSection engagementId={e.id} entities={e.coveredEntities} />
        </div>
      )}

      {/* ── Services (multi-service + components + work) ──────────────────── */}
      {tab === 'services' && (
        <div>
          <ServicesSection engagementId={e.id} services={e.services} />
          <ComponentsSection engagementId={e.id} services={e.services} />
          <ComponentWorkSection engagementId={e.id} />
        </div>
      )}

      {/* ── Work (tasks + client dependencies) ───────────────────────────── */}
      {tab === 'work' && (
        <div>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Tasks</h2>
              <CreateTaskModal engagementId={e.id} team={e.team} />
            </div>
            <Card className="overflow-hidden p-0">
              {tasks.data && tasks.data.items.length === 0 && (
                <div className="p-5">
                  <EmptyState>No tasks on this engagement yet.</EmptyState>
                </div>
              )}
              {tasks.data && tasks.data.items.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2.5 font-semibold">Task</th>
                      <th className="px-4 py-2.5 font-semibold">Assignee</th>
                      <th className="px-4 py-2.5 font-semibold">Priority</th>
                      <th className="px-4 py-2.5 font-semibold">Due</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.data.items.map((t) => (
                      <tr key={t.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{t.title}</td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {t.assignedToName ?? 'Unassigned'}
                        </td>
                        <td className="px-4 py-2.5">
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {t.dueDate ? formatDate(t.dueDate) : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <TaskStatusControl task={t} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>

          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Client dependencies</h2>
              <RequestDependencyModal engagementId={e.id} />
            </div>
            <Card className="overflow-hidden p-0">
              {deps.data && deps.data.items.length === 0 && (
                <div className="p-5">
                  <EmptyState>No information requested from the client.</EmptyState>
                </div>
              )}
              {deps.data && deps.data.items.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2.5 font-semibold">Requested</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Escalation</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {deps.data.items.map((d) => (
                      <tr key={d.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{d.requestedInfo}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">
                          {d.escalationDate ? formatDate(d.escalationDate) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <ClientDependencyActions dep={d} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>
      )}

      {/* ── Compliance ───────────────────────────────────────────────────── */}
      {tab === 'compliance' && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Compliance obligations</h2>
            <div className="flex gap-2">
              <RecordEventButton engagementId={e.id} />
              <GenerateComplianceButton engagementId={e.id} />
            </div>
          </div>
          <Card className="overflow-hidden p-0">
            {compliance.data && compliance.data.items.length === 0 && (
              <div className="p-5">
                <EmptyState>No compliance obligations generated.</EmptyState>
              </div>
            )}
            {compliance.data && compliance.data.items.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2.5 font-semibold">Obligation</th>
                    <th className="px-4 py-2.5 font-semibold">Category</th>
                    <th className="px-4 py-2.5 font-semibold">Statutory</th>
                    <th className="px-4 py-2.5 font-semibold">Internal SLA</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Deadlines</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Extension</th>
                  </tr>
                </thead>
                <tbody>
                  {compliance.data.items.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-ink">{c.complianceRuleName}</td>
                      <td className="px-4 py-2.5">
                        {c.dueDateCategory ? (
                          <Badge tone="neutral">{humanize(c.dueDateCategory)}</Badge>
                        ) : null}
                      </td>
                      <td
                        className={`px-4 py-2.5 ${c.isStatutoryOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}`}
                      >
                        {formatDate(c.effectiveStatutoryDeadline)}
                        {c.isExtended && (
                          <span
                            className="ml-1 text-xs font-medium text-secondary-600"
                            title={
                              c.revisedStatutoryDeadline
                                ? `Government extension — revised from ${formatDate(c.statutoryDeadline)}`
                                : 'Government extension applied'
                            }
                          >
                            · Extended
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 ${c.isInternallyOverdue ? 'font-medium text-warning-700' : 'text-ink-muted'}`}
                      >
                        {formatDate(c.effectiveInternalSlaDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setDeadlinesFor(c)}
                          className="text-xs font-medium text-primary-600 hover:underline"
                        >
                          Manage layers
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <ObligationExtensionActions engagementId={e.id} obligation={c} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {deadlinesFor && (
            <DeadlineLayersModal
              engagementId={e.id}
              obligation={deadlinesFor}
              onClose={() => setDeadlinesFor(null)}
            />
          )}
        </section>
      )}

      {/* ── Documents ────────────────────────────────────────────────────── */}
      {tab === 'documents' && <DocumentsSection engagementId={e.id} />}

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      {tab === 'team' && <TeamSection engagementId={e.id} team={e.team} />}

      {/* ── Activity (lifecycle history) ─────────────────────────────────── */}
      {tab === 'activity' && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Activity</h2>
          <Card className="overflow-hidden p-0">
            {activity.isLoading && <div className="p-5 text-sm text-ink-faint">Loading…</div>}
            {activity.data && activity.data.items.length === 0 && (
              <div className="p-5">
                <EmptyState>No lifecycle activity yet.</EmptyState>
              </div>
            )}
            {activity.data && activity.data.items.length > 0 && (
              <ul className="divide-y divide-line">
                {activity.data.items.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <span className="mt-0.5">
                      <StatusBadge status={a.toStatus} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-ink">
                        {humanize(a.action)}
                        <span className="text-ink-faint">
                          {' '}
                          · {humanize(a.fromStatus)} → {humanize(a.toStatus)}
                        </span>
                      </div>
                      {a.reason && <div className="text-ink-muted">{a.reason}</div>}
                      <div className="text-xs text-ink-faint">
                        {a.actorRole ? `${humanize(a.actorRole)} · ` : ''}
                        {formatDate(a.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* ── Commercial & Billing (§31) ───────────────────────────────────── */}
      {tab === 'invoices' && <InvoicesSection engagementId={e.id} />}

      {/* ── Notes (§26) ──────────────────────────────────────────────────── */}
      {tab === 'notes' && <NotesSection engagementId={e.id} />}
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
