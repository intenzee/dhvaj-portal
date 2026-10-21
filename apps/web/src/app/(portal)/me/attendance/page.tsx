'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceReport } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { addDays, istToday } from '@/lib/people';
import { AttendanceTable } from '@/components/people/hours-tab';
import { Field, Input } from '@/components/form';
import { EmptyState, PageHeader, Spinner } from '@/components/ui';

/** Your own days from your timers: when you started and stopped, and the hours. */
export default function MyAttendancePage(): JSX.Element {
  const today = istToday();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const report = useQuery({
    queryKey: ['me', 'attendance', from, to],
    queryFn: () => apiFetch<AttendanceReport>(`/me/attendance?from=${from}&to=${to}`),
    enabled: !!from && !!to && from <= to,
  });
  return (
    <div>
      <PageHeader
        title="My attendance"
        subtitle="From your timers: first start, last stop and hours by kind, day by day."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" hint="Up to 92 days.">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {report.isLoading && <Spinner label="Loading your days…" />}
      {report.isError && <EmptyState>Could not load your attendance (92 days at most).</EmptyState>}
      {report.data && <AttendanceTable rows={report.data.rows} showPerson={false} />}
    </div>
  );
}
