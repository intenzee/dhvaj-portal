'use client';

import { useState } from 'react';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import { PageHeader, Card, CardBody, EmptyState } from '@/components/ui';
import { UsersSection } from '@/components/admin/users-section';
import { OfficesSection } from '@/components/admin/offices-section';
import { TemplatesSection } from '@/components/admin/templates-section';
import { RulesLibrarySection } from '@/components/admin/rules-library-section';
import { PlanningSignalLibrarySection } from '@/components/admin/planning-signal-library-section';
import { PlanningConsiderationLibrarySection } from '@/components/admin/planning-consideration-library-section';
import { AnalyticsMethodologySection } from '@/components/admin/analytics-methodology-section';
import { MaterialityMethodologySection } from '@/components/admin/materiality-methodology-section';
import { ScopeMethodologySection } from '@/components/admin/scope-methodology-section';

type Tab = 'users' | 'offices' | 'templates' | 'rules' | 'signals' | 'analytics' | 'materiality' | 'scope';

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
    // Firm templates are configured with service.manage (MP / admin).
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'templates' as const, label: 'Templates' }]
      : []),
    // The Rules Library is methodology configuration (service.manage — MP / admin).
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'rules' as const, label: 'Rules Library' }]
      : []),
    // The 03.1 Planning Signal Library is methodology configuration too.
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'signals' as const, label: 'Planning Signal Library' }]
      : []),
    // The 03.2 Analytics Methodology Library — methodology only, no client data.
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'analytics' as const, label: 'Analytics Methodology' }]
      : []),
    // The 03.3 Materiality Methodology Library — guidance only; it never concludes materiality.
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'materiality' as const, label: 'Materiality Methodology' }]
      : []),
    // The 03.4 Scope & Approach Methodology Library — decision lists only; it never concludes scope.
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'scope' as const, label: 'Scope Methodology' }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Manage portal users, role assignments, offices, firm templates, the Rules Library, the Planning Signal Library and the Analytics, Materiality and Scope & Approach Methodology Libraries. Every change is audited."
      />
      <div className="mb-4 flex gap-1 border-b border-line-strong">
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
        <CardBody>
          {tab === 'users' ? (
            <UsersSection />
          ) : tab === 'offices' ? (
            <OfficesSection />
          ) : tab === 'rules' ? (
            <RulesLibrarySection />
          ) : tab === 'analytics' ? (
            <AnalyticsMethodologySection />
          ) : tab === 'materiality' ? (
            <MaterialityMethodologySection />
          ) : tab === 'scope' ? (
            <ScopeMethodologySection />
          ) : tab === 'signals' ? (
            <div className="space-y-8">
              <PlanningSignalLibrarySection />
              <div className="border-t border-line pt-6">
                <PlanningConsiderationLibrarySection />
              </div>
            </div>
          ) : (
            <TemplatesSection />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
