'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import {
  PERMISSION,
  WORKLOAD_OVER_SECONDS,
  WORKLOAD_UNDER_SECONDS,
  type PeopleWorkloadReport,
  type PeopleWorkloadRow,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatDuration } from '@/lib/format';
import { hours, istToday, mondayOf } from '@/lib/people';
import { PeopleSubnav, Tile } from '@/components/people/people-subnav';
import { DataTable } from '@/components/data-table';
import { Field, Input } from '@/components/form';
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui';

/** Each person's load as counts and hours — never a client or engagement name (spec §4.4). */
export default function WorkloadPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.reportReadPeople);
  const [week, setWeek] = useState(mondayOf(istToday()));
  const report = useQuery({
    queryKey: ['people', 'workload', week],
    queryFn: () => apiFetch<PeopleWorkloadReport>(`/people/workload?week=${week}`),
    enabled: allowed && !!week,
  });

  const columns = useMemo<ColumnDef<PeopleWorkloadRow, unknown>[]>(
    () => [
      {
        header: 'Person',
        cell: ({ row }) => (
          <div>
            <span className="block">{row.original.employeeName}</span>
            <span className="block text-xs text-ink-faint">
              {row.original.employeeCode} · {row.original.gradeName} · {row.original.officeCode}
            </span>
          </div>
        ),
      },
      { header: 'Engagements', cell: ({ row }) => row.original.activeEngagements },
      { header: 'As partner', cell: ({ row }) => row.original.asPartner || '—' },
      { header: 'As manager', cell: ({ row }) => row.original.asManager || '—' },
      { header: 'On team', cell: ({ row }) => row.original.asTeam || '—' },
      { header: 'Open tasks', cell: ({ row }) => row.original.openTasks },
      {
        header: 'Overdue',
        cell: ({ row }) =>
          row.original.overdueTasks > 0 ? (
            <span className="font-semibold text-danger-600">{row.original.overdueTasks}</span>
          ) : (
            '—'
          ),
      },
      {
        header: 'Hours this week',
        cell: ({ row }) => {
          const s = row.original.weekSeconds;
          const tone =
            s > WORKLOAD_OVER_SECONDS
              ? 'font-semibold text-danger-600'
              : s < WORKLOAD_UNDER_SECONDS
                ? 'text-warning-700'
                : undefined;
          return <span className={tone}>{formatDuration(s)}</span>;
        },
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Workload" />
        <EmptyState>Workload is for HR and the Managing Partner.</EmptyState>
      </div>
    );
  }

  const exportCsv = (r: PeopleWorkloadReport): void =>
    downloadCsv(
      `workload-week-of-${r.weekStart}`,
      [
        'Code',
        'Person',
        'Grade',
        'Office',
        'Active engagements',
        'As partner',
        'As manager',
        'On team',
        'Open tasks',
        'Overdue tasks',
        'Hours this week',
      ],
      r.rows.map((x) => [
        x.employeeCode,
        x.employeeName,
        x.gradeName,
        x.officeCode,
        x.activeEngagements,
        x.asPartner,
        x.asManager,
        x.asTeam,
        x.openTasks,
        x.overdueTasks,
        hours(x.weekSeconds),
      ]),
    );

  const r = report.data;
  return (
    <div>
      <PageHeader
        title="Workload"
        subtitle="How loaded each person is: engagements and tasks as counts, and hours in the week."
        actions={
          r ? (
            <Button size="sm" variant="secondary" onClick={() => exportCsv(r)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          ) : undefined
        }
      />
      <PeopleSubnav />
      <div className="mb-4">
        <Field label="Week" hint={r ? `Monday ${formatDate(r.weekStart)} to Sunday` : undefined}>
          <Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
        </Field>
      </div>
      {report.isLoading && <Spinner label="Loading workload…" />}
      {report.isError && <EmptyState>Could not load workload.</EmptyState>}
      {r && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="People" value={r.totals.people} />
            <Tile
              label="Over 45 hours"
              value={r.totals.over}
              tone={r.totals.over ? 'danger' : 'neutral'}
            />
            <Tile
              label="Under 20 hours"
              value={r.totals.under}
              tone={r.totals.under ? 'warn' : 'neutral'}
            />
            <Tile
              label="With overdue tasks"
              value={r.totals.withOverdue}
              tone={r.totals.withOverdue ? 'warn' : 'neutral'}
            />
          </div>
          <DataTable
            columns={columns}
            data={r.rows}
            empty="No one to show."
            rowHref={(x) => `/people/employees/${x.employeeId}`}
          />
        </div>
      )}
    </div>
  );
}
