'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import {
  FirmLeaveTab,
  HolidaysTab,
  RegisterTab,
  SettingsTab,
} from '@/components/attendance/register-screen';
import { Button, EmptyState, PageHeader, Spinner } from '@/components/ui';

const TABS = [
  ['register', 'Register'],
  ['leave', 'Leave'],
  ['holidays', 'Holidays'],
  ['settings', 'Settings'],
] as const;
type Tab = (typeof TABS)[number][0];

function Register(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'register') as Tab;
  if (!can(principal, PERMISSION.timeReadAttendance)) {
    return (
      <>
        <PageHeader title="Attendance register" />
        <EmptyState>The attendance register is for HR and the Managing Partner.</EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Attendance register"
        subtitle="Everyone’s month from the hours they log, for payroll — with leave, holidays and the rules."
      />
      <div className="mb-5 flex gap-1" role="tablist" aria-label="Attendance register">
        {TABS.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => router.replace(`/attendance/register?tab=${id}`, { scroll: false })}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'register' && <RegisterTab />}
      {tab === 'leave' && <FirmLeaveTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

export default function AttendanceRegisterPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <Register />
    </Suspense>
  );
}
