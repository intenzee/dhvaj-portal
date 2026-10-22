'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FilingCleanupResult, Stream, TreeItem, TreePeriod } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What a remove / restore did, in a line. */
export function cleanupSummary(r: FilingCleanupResult, verb: 'Removed' | 'Restored'): string {
  if (r.filings === 0)
    return verb === 'Removed' ? 'Nothing open to remove.' : 'Nothing to restore.';
  const parts = [plural(r.filings, 'filing')];
  if (r.tasks > 0) parts.push(plural(r.tasks, 'task'));
  if (r.requests > 0) parts.push(plural(r.requests, 'client request'));
  return `${verb} ${parts.join(', ')}.`;
}

const itemsOf = (p: TreePeriod): TreeItem[] => [
  ...Object.values(p.sections).flatMap((x) => x ?? []),
  ...p.items,
];

/**
 * "Remove this month" on a stream tab's period row (engagement lead): the
 * period's open filings go Not applicable, their open tasks are cancelled and
 * client requests waived — for history the firm keeps elsewhere. Lodged
 * filings stay. A removed month shows "Restore month". Confirms in place.
 */
export function PeriodCleanup({
  engagementId,
  stream,
  period,
  registrationId,
}: {
  engagementId: string;
  stream: Stream;
  period: TreePeriod;
  registrationId: string | null;
}): JSX.Element | null {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const items = itemsOf(period);
  const hasOpen = items.some(
    (i) => i.workflowStatus !== 'filed' && i.workflowStatus !== 'not_applicable',
  );
  const hasRemoved = items.some((i) => i.removed);
  const noun = stream === 'gst' ? 'month' : 'period';

  const run = useMutation({
    mutationFn: (action: 'remove' | 'restore') =>
      apiFetch<FilingCleanupResult>(
        `/engagements/${engagementId}/streams/${stream}/periods/${encodeURIComponent(period.periodKey)}/${action}`,
        { method: 'POST', body: registrationId ? { registrationId } : {} },
      ),
    onSuccess: (r, action) => {
      setConfirming(false);
      setDone(cleanupSummary(r, action === 'remove' ? 'Removed' : 'Restored'));
      void qc.invalidateQueries();
    },
  });

  if (!hasOpen && !hasRemoved && !done) return null;
  const error =
    run.error instanceof ApiError ? run.error.message : run.error ? 'Could not do that.' : null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 pr-4 text-xs"
      data-period-cleanup={period.periodKey}
    >
      {done && <span className="text-ink-muted">{done}</span>}
      {error && <span className="text-danger-700">{error}</span>}
      {confirming ? (
        <>
          <span className="text-ink">Remove {period.label}? Open filings go Not applicable.</span>
          <button
            type="button"
            className="rounded-md border border-danger-500/40 px-2 py-0.5 font-medium text-danger-700 hover:bg-danger-50"
            disabled={run.isPending}
            onClick={() => run.mutate('remove')}
          >
            {run.isPending ? 'Removing…' : 'Yes, remove'}
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-ink-muted hover:bg-surface-sunken"
            onClick={() => setConfirming(false)}
          >
            No
          </button>
        </>
      ) : (
        <>
          {hasOpen && (
            <button
              type="button"
              className="rounded-md border border-line px-2 py-0.5 text-ink-muted hover:border-danger-500/40 hover:text-danger-700"
              title={`Take this ${noun}'s open filings off the portal (history kept on the client)`}
              onClick={() => {
                setDone(null);
                setConfirming(true);
              }}
            >
              Remove this {noun}
            </button>
          )}
          {hasRemoved && (
            <button
              type="button"
              className="rounded-md px-2 py-0.5 text-primary-700 hover:bg-primary-50"
              disabled={run.isPending}
              onClick={() => {
                setDone(null);
                run.mutate('restore');
              }}
            >
              {run.isPending ? 'Restoring…' : `Restore ${noun}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
