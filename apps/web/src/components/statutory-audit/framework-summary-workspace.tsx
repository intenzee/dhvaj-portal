'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import {
  FRAMEWORK_SUMMARY_STATUS_LABEL,
  PERMISSION,
  type FrameworkDashboardRow,
  type FrameworkSummaryStatus,
  type StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { Badge, Card, Spinner } from '@/components/ui';
import { FrameworkSummaryApproval } from './framework-summary-approval';
import { FrameworkSummaryImpact } from './framework-summary-impact';
import { FrameworkSummaryMatters } from './framework-summary-matters';
import { FrameworkSummaryMemo } from './framework-summary-memo';
import { FrameworkSummaryPreview } from './framework-summary-preview';
import { FrameworkSummaryPriorYear } from './framework-summary-prior-year';
import { FrameworkSummaryTriggers } from './framework-summary-triggers';
import { FRAMEWORK_SUMMARY_QK, type FrameworkSummaryPanelProps } from './framework-summary-types';

const STATUS_TONE: Record<FrameworkSummaryStatus, string> = {
  draft: 'neutral',
  ready_for_manager_review: 'info',
  partner_review: 'warn',
  approved: 'success',
  reopened: 'warn',
};

/** Scroll to the source section's card (the dashboard is read-only — edits happen there). */
export function scrollToFrameworkAnchor(anchor: string): void {
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 02.8 Audit Framework Summary & Approval — the consolidated, read-only view
 * of 02.1–02.7 and the remaining framework areas, with the AF-01 / AF-02 gates,
 * the Audit Framework Memorandum, the approval record and the controlled reopen.
 * Every conclusion links back to the section that owns it.
 */
export function FrameworkSummaryWorkspace({
  engagementId,
}: {
  engagementId: string;
}): JSX.Element | null {
  const qc = useQueryClient();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const query = useQuery({
    queryKey: FRAMEWORK_SUMMARY_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditFrameworkSummary[]>(
        `/engagements/${engagementId}/statutory-audit/framework-summary`,
      ),
  });

  const onChanged = () => {
    // The summary, the legacy framework view, the phase skeleton and Planning's gate.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  if (query.isLoading) return <Spinner label="Loading framework summary…" />;
  const summary = query.data?.[0];
  if (!summary) return null;
  const props: FrameworkSummaryPanelProps = { engagementId, summary, canManage, onChanged };

  return (
    <div className="space-y-3">
      <FrameworkSummaryHeaderCard summary={summary} />
      <FrameworkDashboard rows={summary.dashboard} />
      <FrameworkSummaryTriggers {...props} />
      <FrameworkSummaryPreview {...props} />
      <FrameworkSummaryMatters {...props} />
      <FrameworkSummaryPriorYear {...props} />
      <FrameworkSummaryImpact {...props} />
      <FrameworkSummaryMemo {...props} />
      <FrameworkSummaryApproval {...props} />
    </div>
  );
}

function FrameworkSummaryHeaderCard({
  summary,
}: {
  summary: StatutoryAuditFrameworkSummary;
}): JSX.Element {
  const h = summary.header;
  const gate = summary.planning;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            02.8 Audit Framework Summary &amp; Approval
          </h2>
          <p className="text-xs text-ink-muted">{h.periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[h.status]}>{FRAMEWORK_SUMMARY_STATUS_LABEL[h.status]}</Badge>
          <Badge tone="neutral">{h.frameworkVersion}</Badge>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <HeaderFact label="Prepared by" value={h.preparedByName} />
        <HeaderFact label="Engagement Manager" value={h.engagementManagerName} />
        <HeaderFact label="Engagement Partner" value={h.engagementPartnerName} />
        <HeaderFact label="Methodology" value={h.methodologyVersion} />
        <HeaderFact
          label="Open matters"
          value={
            h.blockingMatterCount > 0
              ? `${h.openMatterCount} (${h.blockingMatterCount} blocking)`
              : String(h.openMatterCount)
          }
        />
        <HeaderFact
          label="Section 03 Planning"
          value={gate.unlocked ? (gate.route === 'conditional' ? 'Open (conditional)' : 'Open') : 'Locked'}
        />
      </dl>
      <p
        className={`flex items-start gap-1.5 text-xs ${gate.unlocked ? 'text-success-700' : 'text-ink-muted'}`}
      >
        {gate.unlocked ? (
          <Unlock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        {gate.reason}
      </p>
    </Card>
  );
}

function HeaderFact({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{value ?? '—'}</dd>
    </div>
  );
}

/** §4 Section 02 dashboard — one row per source, each linking back to it. */
export function FrameworkDashboard({ rows }: { rows: FrameworkDashboardRow[] }): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Section 02 dashboard</h3>
        <p className="text-xs text-ink-muted">
          Read-only — correct a conclusion in its own section; the summary follows.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.section} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
            <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-ink-faint">
              {r.section === 'other_areas' ? '02.x' : r.section}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{r.title}</p>
              <p className="text-xs text-ink-muted">
                {r.conclusion ?? 'No conclusion yet'}
                {r.detail ? ` · ${r.detail}` : ''}
              </p>
              {r.attention.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.attention.map((a) => (
                    <li key={a} className="flex items-start gap-1 text-xs text-warning-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {r.status === 'complete' ? (
                <Badge tone="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Complete
                </Badge>
              ) : (
                <Badge tone="warn">Attention required</Badge>
              )}
              <button
                type="button"
                className="text-xs font-medium text-primary-700 hover:underline"
                onClick={() => scrollToFrameworkAnchor(r.anchor)}
              >
                View
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
