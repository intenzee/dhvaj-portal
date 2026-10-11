'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Flag } from 'lucide-react';
import {
  FRAMEWORK_JUDGMENT_CATEGORIES,
  FRAMEWORK_MATTER_CATEGORY_LABEL,
  type FrameworkSystemOverride,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Card, Spinner } from '@/components/ui';
import { PanelHeading, SourceLink } from './framework-summary-shared';
import { FRAMEWORK_SUMMARY_QK, type FrameworkSummaryPanelProps } from './framework-summary-types';

/**
 * 02.8 §12 Significant Framework Judgments and System Overrides — what the
 * Engagement Partner reviews before AF-02: the technical, legal / regulatory
 * and Partner-consultation matters raised in 02.1–02.7, and every system
 * result a professional replaced with a different conclusion (with the reason).
 * The same lists print in the memorandum; each is fixed in its source section.
 */
export function FrameworkSummaryJudgments({
  engagementId,
  summary,
}: FrameworkSummaryPanelProps): JSX.Element {
  const overrides = useQuery({
    queryKey: [...FRAMEWORK_SUMMARY_QK(engagementId), 'overrides', summary.workflowInstanceId],
    queryFn: () =>
      apiFetch<FrameworkSystemOverride[]>(
        `/engagements/${engagementId}/statutory-audit/${summary.workflowInstanceId}/framework-summary/overrides`,
      ),
  });
  const judgments = summary.matters.filter((m) =>
    FRAMEWORK_JUDGMENT_CATEGORIES.includes(m.category),
  );

  return (
    <Card className="p-4" aria-label="Significant Judgments and System Overrides">
      <PanelHeading
        title="Significant Judgments and System Overrides"
        hint="For Engagement Partner review — change a judgment or override in its source section."
      />

      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Significant framework judgments
      </h4>
      {judgments.length === 0 ? (
        <p className="mb-3 text-sm text-ink-muted">No significant framework judgment recorded.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {judgments.map((m) => (
            <li key={m.id} className="rounded-md border border-line bg-surface p-2 text-sm">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-ink-faint">{m.code}</span>
                <span className="font-medium text-ink">{m.title}</span>
                <Badge tone="info">{FRAMEWORK_MATTER_CATEGORY_LABEL[m.category]}</Badge>
                {m.open ? <Badge tone="warn">Open</Badge> : <Badge tone="success">Resolved</Badge>}
                {m.partnerAttention && (
                  <Badge tone="warn">
                    <Flag className="mr-1 h-3 w-3" /> Partner attention
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                <SourceLink source={m.source} />
                {m.resolution ? ` · ${m.resolution}` : ' · No resolution recorded yet'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        System overrides
      </h4>
      {overrides.isLoading ? (
        <Spinner />
      ) : overrides.isError ? (
        <p className="text-sm text-danger-700">Could not load the overrides.</p>
      ) : (overrides.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">No system result was overridden.</p>
      ) : (
        <ul className="space-y-1.5">
          {overrides.data!.map((o) => (
            <li
              key={`${o.source}:${o.title}`}
              className="rounded-md border border-warn-200 bg-warn-50/40 p-2 text-sm"
            >
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-ink">{o.title}</span>
                <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                  System: {o.systemResult ?? '—'} <ArrowRight className="h-3 w-3" /> Conclusion:{' '}
                  <span className="font-medium text-ink">{o.conclusion ?? '—'}</span>
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">Reason: {o.reason ?? '—'}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                <SourceLink source={o.source} />
                {o.overriddenByName ? ` · ${o.overriddenByName}` : ''}
                {o.overriddenAt ? ` · ${formatDate(o.overriddenAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
