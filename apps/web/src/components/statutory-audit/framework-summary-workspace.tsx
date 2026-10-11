'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import {
  FRAMEWORK_SUMMARY_STATUS_LABEL,
  PERMISSION,
  type FrameworkDashboardRow,
  type FrameworkSummaryMatter,
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

/** Anchor of the aggregated Framework Matters panel (§7). */
export const FRAMEWORK_MATTERS_ANCHOR = 'framework-02-8-matters';

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
      <FrameworkDashboard rows={summary.dashboard} matters={summary.matters} />
      <FrameworkSummaryTriggers {...props} />
      <FrameworkSummaryPreview {...props} />
      <div id={FRAMEWORK_MATTERS_ANCHOR} className="scroll-mt-2">
        <FrameworkSummaryMatters {...props} />
      </div>
      <FrameworkSummaryPriorYear {...props} />
      <FrameworkSummaryImpact {...props} />
      <FrameworkSummaryMemo {...props} />
      <FrameworkSummaryApproval {...props} />
    </div>
  );
}

export function FrameworkSummaryHeaderCard({
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
          <p className="mt-1 max-w-2xl text-xs text-ink-muted">
            Review the statutory, financial reporting, auditing and reporting framework
            determined for this engagement before audit planning begins.
          </p>
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
        <div className="flex gap-2">
          <dt className="text-ink-faint">Open matters</dt>
          <dd>
            <button
              type="button"
              className="font-medium text-primary-700 hover:underline"
              onClick={() => scrollToFrameworkAnchor(FRAMEWORK_MATTERS_ANCHOR)}
            >
              {h.openMatterCount}
            </button>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-faint">Blocking matters</dt>
          <dd>
            <button
              type="button"
              className={`font-medium hover:underline ${h.blockingMatterCount > 0 ? 'text-danger-700' : 'text-primary-700'}`}
              onClick={() => scrollToFrameworkAnchor(FRAMEWORK_MATTERS_ANCHOR)}
            >
              {h.blockingMatterCount}
            </button>
          </dd>
        </div>
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
      {h.blockingMatterCount > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-danger-400 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">
            {h.blockingMatterCount === 1
              ? '1 blocking matter prevents'
              : `${h.blockingMatterCount} blocking matters prevent`}{' '}
            Manager confirmation (AF-01) and Partner approval (AF-02).
          </span>
          <button
            type="button"
            className="text-xs font-semibold underline"
            onClick={() => scrollToFrameworkAnchor(FRAMEWORK_MATTERS_ANCHOR)}
          >
            Resolve matters
          </button>
        </div>
      )}
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
export function FrameworkDashboard({
  rows,
  matters = [],
}: {
  rows: FrameworkDashboardRow[];
  matters?: FrameworkSummaryMatter[];
}): JSX.Element {
  const open = matters.filter((m) => m.open).length;
  const blocking = matters.filter((m) => m.blocking).length;
  const resolved = matters.length - open;
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
        <li className="flex flex-wrap items-start gap-3 px-4 py-2.5">
          <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-ink-faint">02.8</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Framework Matters</p>
            <p className="text-xs text-ink-muted">
              {open} open · {resolved} resolved · {blocking} blocking
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {blocking > 0 ? (
              <Badge tone="danger">Blocking</Badge>
            ) : open > 0 ? (
              <Badge tone="warn">Attention required</Badge>
            ) : (
              <Badge tone="success">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Complete
              </Badge>
            )}
            <button
              type="button"
              className="text-xs font-medium text-primary-700 hover:underline"
              onClick={() => scrollToFrameworkAnchor(FRAMEWORK_MATTERS_ANCHOR)}
            >
              View Matters
            </button>
          </div>
        </li>
      </ul>
    </Card>
  );
}
