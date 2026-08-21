'use client';

import { useState } from 'react';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import { PageHeader, Card, CardBody, EmptyState } from '@/components/ui';
import { UsersSection } from '@/components/admin/users-section';
import { OfficesSection } from '@/components/admin/offices-section';

type Tab = 'users' | 'offices';

export default function AdministrationPage(): JSX.Element {
  const { principal } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  // Nav already gates the whole section on user.manage; this is defence in depth
  // (the API enforces every rule regardless of what the UI shows).
  if (!can(principal, PERMISSION.userManage)) {
    return (
      <div>
        <PageHeader title="Administration" />
        <EmptyState>You don’t have permission to administer the firm.</EmptyState>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: 'Users & Roles' },
    { id: 'offices', label: 'Offices' },
  ];

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Manage portal users, role assignments and offices. Every change is audited."
      />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardBody>{tab === 'users' ? <UsersSection /> : <OfficesSection />}</CardBody>
      </Card>
    </div>
  );
}
