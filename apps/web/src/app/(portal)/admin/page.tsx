'use client';

import { useEffect, useState } from 'react';
import { FEATURE_FLAG, PERMISSION, ROLE } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can, hasRole } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { PageHeader, Card, CardBody, EmptyState } from '@/components/ui';
import { UsersSection } from '@/components/admin/users-section';
import { OfficesSection } from '@/components/admin/offices-section';
import { PeopleSection } from '@/components/admin/people-section';
import { TemplatesSection } from '@/components/admin/templates-section';
import { RulesLibrarySection } from '@/components/admin/rules-library-section';
import { PlanningSignalLibrarySection } from '@/components/admin/planning-signal-library-section';
import { PlanningConsiderationLibrarySection } from '@/components/admin/planning-consideration-library-section';
import { AnalyticsMethodologySection } from '@/components/admin/analytics-methodology-section';
import { MaterialityMethodologySection } from '@/components/admin/materiality-methodology-section';
import { ScopeMethodologySection } from '@/components/admin/scope-methodology-section';
import { AuditAreaLibrarySection } from '@/components/admin/audit-area-library-section';
import { WorkflowSection } from '@/components/admin/workflow-section';
import { ChecksSection } from '@/components/admin/checks-section';
import { RolloutSection } from '@/components/admin/rollout-section';
import { NoticeTypesSection } from '@/components/admin/notice-types-section';
import { EngagementPurgeSection } from '@/components/admin/engagement-purge-section';

type Tab =
  | 'users'
  | 'people'
  | 'offices'
  | 'templates'
  | 'rules'
  | 'signals'
  | 'analytics'
  | 'materiality'
  | 'scope'
  | 'areas'
  | 'workflow'
  | 'checks'
  | 'notice-types'
  | 'rollout'
  | 'delete-engagement';

export default function AdministrationPage(): JSX.Element {
  const { principal } = useAuth();
  const administers = can(principal, PERMISSION.userManage);
  const setsWorkflow = can(principal, PERMISSION.workflowManage);
  // Partners come here only for the workflow policy.
  const [tab, setTab] = useState<Tab>(administers ? 'users' : 'workflow');
  const { isOn } = useFeatureFlags();
  const purges = hasRole(principal, ROLE.admin);
  // An engagement's "Delete permanently" link lands here with its code.
  const [purgeCode, setPurgeCode] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('purge');
    if (code && purges) {
      setPurgeCode(code);
      setTab('delete-engagement');
    }
  }, [purges]);

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
    // Employee records — grade, office, portal login, partner details (employee.manage).
    ...(can(principal, PERMISSION.employeeManage)
      ? [{ id: 'people' as const, label: 'People' }]
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
    // The firm's checks: the MP and the administrator switch them; partners see them.
    { id: 'checks' as const, label: 'Checks' },
    // PS-101: the notice types library the stream leads maintain (ff_notices).
    ...(setsWorkflow && isOn(FEATURE_FLAG.notices)
      ? [{ id: 'notice-types' as const, label: 'Notice types' }]
      : []),
    // Each Staff Workflow phase, office by office (user.manage — MP / admin).
    ...(administers ? [{ id: 'rollout' as const, label: 'Rollout' }] : []),
    // Deleting an engagement opened by mistake rests with the administrator alone.
    ...(purges ? [{ id: 'delete-engagement' as const, label: 'Delete engagement' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Manage portal users, role assignments, people (employee records), offices, firm templates, the Rules Library, the Planning Signal Library, the Analytics, Materiality and Scope & Approach Methodology Libraries, the Audit Area Library, the firm’s workflow policy and checks, and the rollout of each phase. Every change is audited."
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
          ) : tab === 'people' ? (
            <PeopleSection />
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
          ) : tab === 'checks' ? (
            <ChecksSection />
          ) : tab === 'notice-types' ? (
            <NoticeTypesSection />
          ) : tab === 'rollout' ? (
            <RolloutSection />
          ) : tab === 'delete-engagement' ? (
            <EngagementPurgeSection key={purgeCode} initialCode={purgeCode} />
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
