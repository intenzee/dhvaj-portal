'use client';

import { ArrowUpRight } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Badge, Spinner } from '@/components/ui';
import { SECTION_ANCHOR } from './entity-profile-workspace';
import { useReportingRecords } from './reporting-records-query';

/**
 * 02.7 cross-references (spec §15, §17): what CARO (02.4), the ICFR workstream
 * (02.5) and consolidation / branch audit (02.6) say for the auditor's report —
 * read from those workspaces, never a second register. Each opens its source.
 */
export function OtherReportingCrossRefs({
  engagementId,
  workflowInstanceId,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element {
  const { q } = useReportingRecords(engagementId, workflowInstanceId);
  if (q.isLoading) return <Spinner label="Loading the cross-references…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the cross-references.'}
      </p>
    );
  }
  const open = (subSectionKey: string) => {
    const id = SECTION_ANCHOR[subSectionKey];
    if (id) document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return (
    <section className="space-y-2 text-xs" aria-label="Cross-references">
      {q.data.crossRefLinks.map((l) => (
        <div key={l.key} className="rounded-md border border-line p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{l.label}</span>
            {l.attention ? (
              <Badge tone="warn">Needs attention</Badge>
            ) : (
              <Badge tone="success">Ready</Badge>
            )}
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 text-primary-600 hover:underline"
              onClick={() => open(l.subSectionKey)}
            >
              Open {l.subSectionKey} <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
            {l.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-1 text-ink-faint">Final stage: {l.finalStage}</p>
        </div>
      ))}
    </section>
  );
}
