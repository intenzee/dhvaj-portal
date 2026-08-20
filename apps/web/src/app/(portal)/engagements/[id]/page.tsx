'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import type { EngagementDetail, MyTask, ComplianceRow } from '@/lib/types';
import { PageHeader, Spinner, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';

export default function EngagementDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  const eng = useQuery({
    queryKey: ['engagement', id],
    queryFn: () => apiFetch<EngagementDetail>(`/engagements/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  const tasks = useQuery({
    queryKey: ['engagement', id, 'tasks'],
    queryFn: () => apiFetch<Paginated<MyTask & { assignedToName: string | null }>>(`/engagements/${id}/tasks?limit=50`),
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
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50"
          >
            Client 360 →
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Overview</CardTitle>
            <StatusBadge status={e.status} />
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

        <Card>
          <CardHeader>
            <CardTitle>Team ({e.team.length})</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {e.team.length === 0 && <p className="text-sm text-ink-faint">No team assigned yet.</p>}
            {e.team.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">{m.employeeName}</span>
                <Badge>{humanize(m.roleOnEngagement)}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Tasks</h2>
          <Card className="p-0">
            {tasks.data && (
              <DataTable columns={taskCols} data={tasks.data.items} empty="No tasks on this engagement yet." />
            )}
          </Card>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Compliance obligations</h2>
          <Card className="p-0">
            {compliance.data && (
              <DataTable
                columns={complianceCols}
                data={compliance.data.items}
                empty="No compliance obligations generated for this engagement."
              />
            )}
          </Card>
        </section>
      </div>
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

const taskCols: ColumnDef<MyTask & { assignedToName: string | null }, unknown>[] = [
  { header: 'Task', accessorKey: 'title' },
  { header: 'Assignee', cell: ({ row }) => row.original.assignedToName ?? <span className="text-ink-faint">Unassigned</span> },
  { header: 'Priority', cell: ({ row }) => <Badge>{humanize(row.original.priority)}</Badge> },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  { header: 'Due', cell: ({ row }) => (row.original.dueDate ? formatDate(row.original.dueDate) : '—') },
];

const complianceCols: ColumnDef<ComplianceRow, unknown>[] = [
  { header: 'Obligation', accessorKey: 'complianceRuleName' },
  {
    header: 'Statutory',
    cell: ({ row }) => (
      <span className={row.original.isStatutoryOverdue ? 'font-medium text-rose-600' : ''}>
        {formatDate(row.original.effectiveStatutoryDeadline)}
      </span>
    ),
  },
  {
    header: 'Internal SLA',
    cell: ({ row }) => (
      <span className={row.original.isInternallyOverdue ? 'font-medium text-amber-700' : ''}>
        {formatDate(row.original.effectiveInternalSlaDate)}
      </span>
    ),
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];
