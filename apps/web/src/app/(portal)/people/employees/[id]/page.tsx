'use client';

import { useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PERMISSION } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, type Principal } from '@/lib/principal';
import { readsPeople } from '@/lib/people';
import { cn } from '@/lib/cn';
import type { AdminEmployeeRow } from '@/lib/types';
import { ProfileTab } from '@/components/people/profile-tab';
import { ArticleshipTab } from '@/components/people/articleship-tab';
import { LoginTab } from '@/components/people/login-tab';
import { HoursTab } from '@/components/people/hours-tab';
import { HrDocumentsTab } from '@/components/people/hr-documents-tab';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { SalaryTab } from '@/components/payroll/salary-tab';
import { BankIdsTab } from '@/components/payroll/bank-ids-tab';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui';

interface PersonTab {
  id: string;
  label: string;
  show: (principal: Principal | null, e: AdminEmployeeRow) => boolean;
  render: (e: AdminEmployeeRow) => ReactNode;
}

/**
 * The person's tabs. Payroll adds "Salary" and "Bank & IDs" here (spec §4.8),
 * each gated on its own permission, after "Hours".
 */
const TABS: PersonTab[] = [
  { id: 'profile', label: 'Profile', show: () => true, render: (e) => <ProfileTab employee={e} /> },
  {
    id: 'articleship',
    label: 'Articleship',
    show: (_p, e) => e.gradeSlug === 'article',
    render: (e) => <ArticleshipTab employee={e} />,
  },
  {
    id: 'login',
    label: 'Portal login',
    show: (p) => can(p, PERMISSION.employeeManage),
    render: (e) => <LoginTab employee={e} />,
  },
  {
    id: 'hours',
    label: 'Hours',
    show: (p) => readsPeople(p),
    render: (e) => <HoursTab employeeId={e.id} />,
  },
  {
    id: 'salary',
    label: 'Salary',
    show: (p) => can(p, PERMISSION.payrollRead),
    render: (e) => <SalaryTab employeeId={e.id} />,
  },
  {
    id: 'bank',
    label: 'Bank & IDs',
    show: (p) => can(p, PERMISSION.payrollPrepare),
    render: (e) => <BankIdsTab employeeId={e.id} />,
  },
  {
    id: 'documents',
    label: 'Documents',
    show: (p) => readsPeople(p) && can(p, PERMISSION.employeeManage),
    render: (e) => <HrDocumentsTab employeeId={e.id} />,
  },
];

export default function PersonPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { principal } = useAuth();
  const [tab, setTab] = useState('profile');
  const employee = useQuery({
    queryKey: ['people', 'employee', id],
    queryFn: () => apiFetch<AdminEmployeeRow>(`/employees/${id}`),
    enabled: can(principal, PERMISSION.employeeRead),
  });
  const back = { href: '/people/employees', label: 'Employees' };

  if (!can(principal, PERMISSION.employeeRead)) {
    return (
      <div>
        <PageHeader title="Employee" back={back} />
        <EmptyState>You don’t have access to employee records.</EmptyState>
      </div>
    );
  }
  if (employee.isLoading) return <Spinner label="Loading…" />;
  if (!employee.data) {
    return (
      <div>
        <PageHeader title="Employee" back={back} />
        <EmptyState>Not found, or outside what you can see.</EmptyState>
      </div>
    );
  }

  const e = employee.data;
  const tabs = TABS.filter((t) => t.show(principal, e));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  return (
    <div>
      <PageHeader
        title={e.fullName}
        subtitle={`${e.employeeCode} · ${e.gradeName} · ${e.officeCode}`}
        back={back}
        actions={
          e.employmentStatus !== 'active' ? (
            <Badge tone={e.employmentStatus === 'exited' ? 'danger' : 'warn'}>
              {e.employmentStatus === 'exited'
                ? 'Exited'
                : e.employmentStatus === 'notice_period'
                  ? 'On notice'
                  : 'On leave'}
            </Badge>
          ) : undefined
        }
      />
      <PeopleSubnav />
      <div role="tablist" className="mb-4 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              t.id === current.id
                ? 'bg-primary-50 text-primary-700'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current.render(e)}
    </div>
  );
}
