'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { ROLE, type AttendanceMonth } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasRole } from '@/lib/principal';
import { loggableDays, thisMonth } from '@/lib/attendance';
import { MyDayTab } from '@/components/attendance/my-day';
import { LeaveTab } from '@/components/attendance/leave-tab';
import {
  MonthCalendar,
  MonthPicker,
  StatusKey,
  SummaryChips,
} from '@/components/attendance/month-view';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

const TABS = [
  { id: 'day', label: 'My day' },
  { id: 'month', label: 'Month' },
  { id: 'leave', label: 'Leave' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function MonthTab({ onDay }: { onDay: (day: string) => void }): JSX.Element {
  const [month, setMonth] = useState(thisMonth());
  const q = useQuery({
    queryKey: ['attendance', 'month', month],
    queryFn: () => apiFetch<AttendanceMonth>(`/attendance/month/${month}`),
  });
  const open = loggableDays();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={setMonth} />
        <StatusKey />
      </div>
      {q.isLoading && <Spinner label="Loading the month…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the month.'}
        </EmptyState>
      )}
      {q.data && (
        <>
          <SummaryChips s={q.data.person.summary} />
          <Card className="p-4">
            <MonthCalendar
              days={q.data.person.days}
              onPick={onDay}
              canPick={(d) => open.includes(d)}
            />
            <p className="mt-3 text-xs text-ink-muted">
              {q.data.settings.presentMinutes / 60} hours make a day present,{' '}
              {q.data.settings.halfDayMinutes / 60} a half day. Click today or the last 3 days to
              add work.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Attendance(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'day') as Tab;
  const day = params.get('day') ?? undefined;
  const go = (t: Tab, d?: string) =>
    router.replace(`/attendance?tab=${t}${d ? `&day=${d}` : ''}`, { scroll: false });
  const leads = hasRole(
    principal,
    ROLE.managingPartner,
    ROLE.admin,
    ROLE.partner,
    ROLE.manager,
    ROLE.senior,
  );

  if (principal && !principal.employeeId) {
    return (
      <>
        <PageHeader title="My attendance" />
        <EmptyState>
          Attendance is kept for people on the firm’s staff list; this sign-in is not linked to one.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="My attendance"
        subtitle="Log what you did — client, task, hours and where you worked. 8 hours in a day marks you present."
        actions={
          leads ? (
            <Link href="/attendance/team">
              <Button variant="secondary" size="sm">
                <Users className="h-4 w-4" /> Team attendance
              </Button>
            </Link>
          ) : undefined
        }
      />
      <div className="mb-5 flex gap-1" role="tablist" aria-label="Attendance">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            role="tab"
            aria-selected={tab === t.id}
            variant={tab === t.id ? 'primary' : 'secondary'}
            onClick={() => go(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {tab === 'day' && <MyDayTab key={day ?? 'today'} initialDay={day} />}
      {tab === 'month' && <MonthTab onDay={(d) => go('day', d)} />}
      {tab === 'leave' && <LeaveTab />}
    </>
  );
}

export default function AttendancePage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <Attendance />
    </Suspense>
  );
}
