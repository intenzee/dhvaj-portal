'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConsolidationWorkProgramme as Programme } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Spinner } from '@/components/ui';
import { groupAuditBase, groupAuditKey, ToggleHeader } from './consolidation-group-shared';

/**
 * 02.6 Part B — Consolidation work programme (DHVAJ 02.6 spec §19). Generated
 * from the versioned DHVAJ library once 02.6 requires a CFS, one item per area
 * with its applicability and basis, each applicable item becoming a Section 06
 * procedure in the CFS work area (replacing the generic CFS programme). When
 * CFS stops being required the programme is withdrawn, never deleted. Read-only
 * here — the work is done in Section 06. Items expand inline (+/−).
 */
export function ConsolidationWorkProgramme({
  engagementId,
  workflowInstanceId,
}: {
  engagementId: string;
  workflowInstanceId: string;
  /** Accepted for a uniform host API; the programme is read-only here. */
  canManage?: boolean;
}): JSX.Element {
  const q = useQuery({
    queryKey: [...groupAuditKey(engagementId, workflowInstanceId), 'work-programme'],
    queryFn: () =>
      apiFetch<Programme>(`${groupAuditBase(engagementId, workflowInstanceId)}/work-programme`),
  });
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Spinner label="Loading the consolidation work programme…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the work programme.'}
      </p>
    );
  }
  const wp = q.data;
  const applicable = wp.items.filter((i) => i.applicable && !i.withdrawn);
  return (
    <section className="space-y-2" aria-label="Consolidation work programme">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">Consolidation work programme</h4>
        <Badge tone={wp.state === 'active' ? 'info' : wp.state === 'awaiting' ? 'warn' : 'neutral'}>
          {wp.state === 'active'
            ? 'Generated'
            : wp.state === 'awaiting'
              ? 'Awaiting 02.6'
              : wp.state === 'withdrawn'
                ? 'Withdrawn'
                : 'Not required'}
        </Badge>
        {wp.state === 'active' && (
          <Badge>
            {wp.linked} of {applicable.length} in Section 06
          </Badge>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        {wp.reason}
        {wp.frameworkLabel ? ` · ${wp.frameworkLabel}` : ''}
        {wp.generatedAt ? ` · generated ${formatDate(wp.generatedAt)}` : ''}
      </p>
      {wp.items.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Work items">
          {wp.items.map((i) => (
            <li key={i.id}>
              <ToggleHeader
                open={open === i.id}
                onToggle={() => setOpen((o) => (o === i.id ? null : i.id))}
                label={`work item ${i.title}`}
                muted={i.withdrawn || !i.applicable}
              >
                <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
                {i.withdrawn ? (
                  <Badge>Withdrawn</Badge>
                ) : i.applicable ? (
                  i.procedureRef ? (
                    <Badge tone="info">
                      {i.procedureRef}
                      {i.procedureStatus ? ` · ${i.procedureStatus.replace(/_/g, ' ')}` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="warn">Not yet in Section 06</Badge>
                  )
                ) : (
                  <Badge>N/A</Badge>
                )}
              </ToggleHeader>
              {open === i.id && (
                <div className="space-y-1 border-t border-line bg-surface-sunken/30 px-3 py-2 text-xs">
                  <p className="text-ink-muted">
                    <span className="font-medium text-ink">Applicability:</span> {i.basis}
                  </p>
                  <p className="text-ink">{i.objective}</p>
                  <p className="text-ink-muted">
                    <span className="font-medium text-ink">Evidence:</span> {i.evidence}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
