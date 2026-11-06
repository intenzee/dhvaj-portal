'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AttendanceRegister } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { LeaveApprovalsPanel, TeamMonth } from '@/components/attendance/team-screen';
import { Button, PageHeader, Spinner } from '@/components/ui';

const loadTeam = (month: string) => apiFetch<AttendanceRegister>(`/attendance/team/${month}`);

function Team(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'leave' ? 'leave' : 'month';
  return (
    <>
      <PageHeader
        title="Team attendance"
        subtitle="Everyone who reports to you, at any level: their days, hours and leave."
        back={{ href: '/attendance', label: 'My attendance' }}
      />
      <div className="mb-5 flex gap-1" role="tablist" aria-label="Team attendance">
        {(
          [
            ['month', 'Month'],
            ['leave', 'Leave to approve'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => router.replace(`/attendance/team?tab=${id}`, { scroll: false })}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'month' ? (
        <TeamMonth
          scope="team"
          load={loadTeam}
          empty="Nobody reports to you yet (People → reporting line)."
        />
      ) : (
        <LeaveApprovalsPanel />
      )}
    </>
  );
}

export default function TeamAttendancePage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <Team />
    </Suspense>
  );
}
