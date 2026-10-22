'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PERMISSION, type MonthlyHoursReport } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { downloadCsv } from '@/lib/csv';
import { formatDuration } from '@/lib/format';
import { hours, istToday } from '@/lib/people';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { Field, Input } from '@/components/form';
import { Button, EmptyState, PageHeader, Panel, Spinner } from '@/components/ui';

/** People reports: the monthly hours export, one row per person. */
export default function PeopleReportsPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = can(principal, PERMISSION.reportReadPeople);
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const report = useQuery({
    queryKey: ['people', 'reports', 'hours', month],
    queryFn: () => apiFetch<MonthlyHoursReport>(`/people/reports/hours?month=${month}`),
    enabled: allowed && /^\d{4}-\d{2}$/.test(month),
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="People reports" />
        <EmptyState>People reports are for HR and the Managing Partner.</EmptyState>
      </div>
    );
  }

  const r = report.data;
  const exportCsv = (): void =>
    r &&
    downloadCsv(
      `hours-${r.month}`,
      [
        'Code',
        'Person',
        'Office',
        'Grade',
        'Days with time',
        'Work h',
        'Review h',
        'Other h',
        'Total h',
      ],
      r.rows.map((x) => [
        x.employeeCode,
        x.employeeName,
        x.officeCode,
        x.gradeName,
        x.daysWithTime,
        hours(x.workSeconds),
        hours(x.reviewSeconds),
        hours(x.otherSeconds),
        hours(x.totalSeconds),
      ]),
    );

  return (
    <div>
      <PageHeader title="People reports" subtitle="Hours by person, by month." />
      <PeopleSubnav />
      <Panel
        title="Monthly hours"
        action={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!r?.rows.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      >
        <div className="mb-4">
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </div>
        {report.isLoading && <Spinner label="Loading hours…" />}
        {report.isError && <EmptyState>Could not load the hours.</EmptyState>}
        {r && r.rows.length === 0 && <EmptyState>No one to show for this month.</EmptyState>}
        {r && r.rows.length > 0 && (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="pb-1 font-medium">Person</th>
                  <th className="pb-1 text-right font-medium">Days</th>
                  <th className="pb-1 text-right font-medium">Work</th>
                  <th className="pb-1 text-right font-medium">Review</th>
                  <th className="pb-1 text-right font-medium">Other</th>
                  <th className="pb-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.employeeId} className="border-t border-line">
                    <td className="py-1.5">
                      {x.employeeName}{' '}
                      <span className="text-xs text-ink-faint">
                        {x.employeeCode} · {x.gradeName} · {x.officeCode}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{x.daysWithTime}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatDuration(x.workSeconds)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatDuration(x.reviewSeconds)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatDuration(x.otherSeconds)}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {formatDuration(x.totalSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
