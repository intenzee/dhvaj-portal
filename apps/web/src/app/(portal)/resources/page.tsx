'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  PERMISSION,
  type ResourceGroupRow,
  type ResourceWorkloadReport,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Spinner,
  EmptyState,
  Button,
} from '@/components/ui';

export default function ResourcesPage(): JSX.Element {
  const { principal } = useAuth();

  if (!can(principal, PERMISSION.employeeRead)) {
    return (
      <div>
        <PageHeader title="Resource Management" />
        <EmptyState>You don’t have permission to view resource workload.</EmptyState>
      </div>
    );
  }
  return <Resources />;
}

function Resources(): JSX.Element {
  const q = useQuery({
    queryKey: ['resources', 'workload'],
    queryFn: () => apiFetch<ResourceWorkloadReport>('/resources/workload'),
  });

  return (
    <div>
      <PageHeader
        title="Resource Management"
        subtitle="Who is carrying what, across everything you can see. Firm-wide for partners; scoped by the database. Active EP/manager/member load plus open and overdue tasks."
      />
      {q.isLoading && <Spinner label="Loading workload…" />}
      {q.data && <Workload r={q.data} />}
    </div>
  );
}

function Workload({ r }: { r: ResourceWorkloadReport }): JSX.Element {
  if (r.rows.length === 0) {
    return <EmptyState>No people with visible workload in your scope.</EmptyState>;
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="People" value={r.totals.people} />
        <Tile label="Active assignments" value={r.totals.activeAssignments} />
        <Tile label="Open tasks" value={r.totals.openTasks} />
        <Tile label="Overdue tasks" value={r.totals.overdueTasks} tone="danger" />
        <Tile label="Overloaded" value={r.totals.overloaded} tone="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GroupCard title="By office" rows={r.byOffice} />
        <GroupCard title="By grade" rows={r.byGrade} />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Workload by person</CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              downloadCsv(
                'resource-workload',
                ['Employee', 'Grade', 'Office', 'As EP', 'As Manager', 'As Member', 'Open tasks', 'Overdue tasks'],
                r.rows.map((x) => [
                  x.employeeName,
                  x.gradeName ?? '',
                  x.officeCode,
                  x.asEp,
                  x.asManager,
                  x.asMember,
                  x.openTasks,
                  x.overdueTasks,
                ]),
              )
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </CardHeader>
        <CardBody>
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pr-4 font-semibold">Employee</th>
                  <th className="py-2 pr-4 font-semibold">Office</th>
                  <th className="py-2 pr-4 font-semibold">EP</th>
                  <th className="py-2 pr-4 font-semibold">Mgr</th>
                  <th className="py-2 pr-4 font-semibold">Member</th>
                  <th className="py-2 pr-4 font-semibold">Open</th>
                  <th className="py-2 pr-4 font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.employeeId} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">
                      <span className="block font-medium text-ink">{x.employeeName}</span>
                      {x.gradeName && (
                        <span className="block text-xs text-ink-faint">{x.gradeName}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{x.officeCode}</td>
                    <td className="py-2 pr-4 tabular-nums">{x.asEp}</td>
                    <td className="py-2 pr-4 tabular-nums">{x.asManager}</td>
                    <td className="py-2 pr-4 tabular-nums">{x.asMember}</td>
                    <td className="py-2 pr-4 tabular-nums">{x.openTasks}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {x.overdueTasks > 0 ? (
                        <span className="font-medium text-danger-600">{x.overdueTasks}</span>
                      ) : (
                        x.overdueTasks
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warn' | 'danger';
}): JSX.Element {
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div
        className={cn(
          'mt-1 text-3xl font-bold tabular-nums',
          tone === 'danger' ? 'text-danger-600' : tone === 'warn' ? 'text-warning-700' : 'text-ink',
        )}
      >
        {formatCount(value)}
      </div>
    </div>
  );
}

function GroupCard({ title, rows }: { title: string; rows: ResourceGroupRow[] }): JSX.Element {
  const max = Math.max(1, ...rows.map((g) => g.activeAssignments));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState>No data.</EmptyState>
        ) : (
          <div className="space-y-1">
            {rows.map((g) => {
              const pct = Math.max(2, Math.round((g.activeAssignments / max) * 100));
              return (
                <div key={g.key} className="flex items-center gap-3 py-1">
                  <span className="w-28 shrink-0 truncate text-sm text-ink" title={g.label}>
                    {g.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                    {g.people} ppl · {g.activeAssignments}
                    {g.overdueTasks > 0 && (
                      <span className="ml-1 text-danger-600">· {g.overdueTasks} od</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
