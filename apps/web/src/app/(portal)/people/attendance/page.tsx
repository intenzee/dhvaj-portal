'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { AttendanceReport } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/csv';
import { hours, istTime, istToday, mondayOf, readsPeople } from '@/lib/people';
import { AttendanceTable } from '@/components/people/hours-tab';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { Field, Input, Select } from '@/components/form';
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui';

/** Everyone's days from the timers: in, out and hours by kind (spec §4.3). */
export default function AttendancePage(): JSX.Element {
  const { principal } = useAuth();
  const allowed = readsPeople(principal);
  const today = istToday();
  const [from, setFrom] = useState(mondayOf(today));
  const [to, setTo] = useState(today);
  const [office, setOffice] = useState('');
  const report = useQuery({
    queryKey: ['people', 'attendance', from, to],
    queryFn: () => apiFetch<AttendanceReport>(`/people/attendance?from=${from}&to=${to}`),
    enabled: allowed && !!from && !!to && from <= to,
  });
  const offices = useMemo(
    () => [...new Set((report.data?.rows ?? []).map((r) => r.officeCode).filter(Boolean))].sort(),
    [report.data],
  ) as string[];
  const rows = (report.data?.rows ?? []).filter((r) => !office || r.officeCode === office);

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Attendance" />
        <EmptyState>Attendance is for HR and the Managing Partner.</EmptyState>
      </div>
    );
  }

  const exportCsv = (): void =>
    downloadCsv(
      `attendance-${from}-to-${to}`,
      [
        'Day',
        'Code',
        'Person',
        'Office',
        'Grade',
        'In',
        'Out',
        'Work h',
        'Review h',
        'Other h',
        'Total h',
      ],
      rows.map((r) => [
        r.day,
        r.employeeCode,
        r.employeeName,
        r.officeCode,
        r.gradeName,
        istTime(r.firstStart),
        r.running ? 'running' : istTime(r.lastStop),
        hours(r.workSeconds),
        hours(r.reviewSeconds),
        hours(r.otherSeconds),
        hours(r.totalSeconds),
      ]),
    );

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="From the timers: first start, last stop and hours by kind. Never what the time was spent on."
        actions={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <PeopleSubnav />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" hint="Up to 92 days.">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Office">
          <Select value={office} onChange={(e) => setOffice(e.target.value)}>
            <option value="">All offices</option>
            {offices.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {report.isLoading && <Spinner label="Loading attendance…" />}
      {report.isError && <EmptyState>Could not load attendance (92 days at most).</EmptyState>}
      {report.data && <AttendanceTable rows={rows} showPerson />}
    </div>
  );
}
