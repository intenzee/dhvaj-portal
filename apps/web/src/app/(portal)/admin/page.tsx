'use client';

import { useState } from 'react';
import { FEATURE_FLAG, PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
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
import { AuditAreaLibrarySection } from '@/components/admin/audit-area-library-section';
import { WorkflowSection } from '@/components/admin/workflow-section';
import { RolloutSection } from '@/components/admin/rollout-section';
import { NoticeTypesSection } from '@/components/admin/notice-types-section';

type Tab =
  | 'users'
  | 'offices'
  | 'templates'
  | 'rules'
  | 'signals'
  | 'analytics'
  | 'materiality'
  | 'scope'
  | 'areas'
  | 'workflow'
  | 'notice-types'
  | 'rollout';

export default function AdministrationPage(): JSX.Element {
  const { principal } = useAuth();
  const administers = can(principal, PERMISSION.userManage);
  const setsWorkflow = can(principal, PERMISSION.workflowManage);
  // Partners come here only for the workflow policy.
  const [tab, setTab] = useState<Tab>(administers ? 'users' : 'workflow');
  const { isOn } = useFeatureFlags();

  // Nav already gates the whole section on user.manage or workflow.manage; this
  // is defence in depth (the API enforces every rule regardless of the UI).
  if (!administers && !setsWorkflow) {
    return (
      <div>
        <PageHeader title="Administration" />
        <EmptyState>You don’t have permission to administer the firm.</EmptyState>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    ...(administers
      ? [
          { id: 'users' as const, label: 'Users & Roles' },
          { id: 'offices' as const, label: 'Offices' },
        ]
      : []),
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
    // The 03.5 Audit Area Library — versioned methodology; releases are immutable.
    ...(can(principal, PERMISSION.serviceManage)
      ? [{ id: 'areas' as const, label: 'Audit Area Library' }]
      : []),
    // The partners' answers to the Staff Workflow plan's questions.
    ...(setsWorkflow ? [{ id: 'workflow' as const, label: 'Workflow' }] : []),
    // PS-101: the notice types library the stream leads maintain (ff_notices).
    ...(setsWorkflow && isOn(FEATURE_FLAG.notices)
      ? [{ id: 'notice-types' as const, label: 'Notice types' }]
      : []),
    // Each Staff Workflow phase, office by office (user.manage — MP / admin).
    ...(administers ? [{ id: 'rollout' as const, label: 'Rollout' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Manage portal users, role assignments, offices, firm templates, the Rules Library, the Planning Signal Library, the Analytics, Materiality and Scope & Approach Methodology Libraries, the Audit Area Library, the firm’s workflow policy and the rollout of each phase. Every change is audited."
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
          ) : tab === 'areas' ? (
            <AuditAreaLibrarySection />
          ) : tab === 'workflow' ? (
            <WorkflowSection />
          ) : tab === 'notice-types' ? (
            <NoticeTypesSection />
          ) : tab === 'rollout' ? (
            <RolloutSection />
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
