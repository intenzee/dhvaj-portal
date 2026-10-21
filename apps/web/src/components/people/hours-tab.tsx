'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceDay, AttendanceReport } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/format';
import { addDays, istTime, istToday } from '@/lib/people';
import { Field, Input } from '@/components/form';
import { Card, CardBody, EmptyState, Spinner } from '@/components/ui';

/** One person's days: in, out and hours by kind. Never what the hours were on. */
export function HoursTab({ employeeId }: { employeeId: string }): JSX.Element {
  const today = istToday();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const report = useQuery({
    queryKey: ['people', 'attendance', from, to],
    queryFn: () => apiFetch<AttendanceReport>(`/people/attendance?from=${from}&to=${to}`),
    enabled: !!from && !!to && from <= to,
  });
  const rows = (report.data?.rows ?? []).filter((r) => r.employeeId === employeeId);

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap gap-3">
          <Field label="From">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {report.isLoading && <Spinner label="Loading hours…" />}
        {report.isError && <EmptyState>Could not load the hours (92 days at most).</EmptyState>}
        {report.data && <AttendanceTable rows={rows} showPerson={false} />}
      </CardBody>
    </Card>
  );
}

/** Days with time: when in and out, and the hours by kind. */
export function AttendanceTable({
  rows,
  showPerson,
}: {
  rows: AttendanceDay[];
  showPerson: boolean;
}): JSX.Element {
  if (rows.length === 0) return <EmptyState>No time logged in these dates.</EmptyState>;
  const total = rows.reduce((s, r) => s + r.totalSeconds, 0);
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th className="pb-1 font-medium">Day</th>
            {showPerson && <th className="pb-1 font-medium">Person</th>}
            <th className="pb-1 font-medium">In</th>
            <th className="pb-1 font-medium">Out</th>
            <th className="pb-1 text-right font-medium">Work</th>
            <th className="pb-1 text-right font-medium">Review</th>
            <th className="pb-1 text-right font-medium">Other</th>
            <th className="pb-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.employeeId}-${r.day}`} className="border-t border-line">
              <td className="py-1.5 whitespace-nowrap">{formatDate(r.day)}</td>
              {showPerson && (
                <td className="py-1.5">
                  {r.employeeName ?? '—'}{' '}
                  <span className="text-xs text-ink-faint">
                    {r.employeeCode} · {r.officeCode}
                  </span>
                </td>
              )}
              <td className="py-1.5 tabular-nums">{istTime(r.firstStart)}</td>
              <td className="py-1.5 tabular-nums">
                {r.running ? (
                  <span className="text-success-700">running</span>
                ) : (
                  istTime(r.lastStop)
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatDuration(r.workSeconds)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatDuration(r.reviewSeconds)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatDuration(r.otherSeconds)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {formatDuration(r.totalSeconds)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong">
            <td className="pt-2 text-xs text-ink-muted" colSpan={showPerson ? 7 : 6}>
              {rows.length} day{rows.length === 1 ? '' : 's'} with time
            </td>
            <td className="pt-2 text-right font-semibold tabular-nums">{formatDuration(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
