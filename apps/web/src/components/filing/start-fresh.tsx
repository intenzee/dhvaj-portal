'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FilingCleanupResult } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, CardBody } from '@/components/ui';
import { cleanupSummary } from './period-cleanup';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09' → 'Sep 2026'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

/**
 * Start fresh (Managing Partner): every overdue filing for a period that
 * ended before the chosen month goes Not applicable, with its open tasks
 * cancelled and client requests waived — the history lives on the client.
 * Filings not yet due, and lodged ones, stay. Preview first, then confirm;
 * a month can be brought back from its stream tab (Restore month).
 */
export function StartFreshPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [month, setMonth] = useState('2026-09');
  const [preview, setPreview] = useState<FilingCleanupResult | null>(null);
  const [done, setDone] = useState<FilingCleanupResult | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<FilingCleanupResult>('/filings/start-fresh', {
        method: 'POST',
        body: { from: `${month}-01`, dryRun },
      }),
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        return;
      }
      setPreview(null);
      setDone(r);
      void qc.invalidateQueries();
    },
  });
  const error =
    run.error instanceof ApiError ? run.error.message : run.error ? 'Could not do that.' : null;
  const label = monthLabel(month);

  return (
    <Card className="mb-4" data-part="start-fresh">
      <CardBody className="space-y-3 text-sm">
        <p className="text-ink">
          <span className="font-medium">Start fresh.</span> Clear every overdue filing for a period
          before the month you pick, across all clients. They show Not applicable; their open tasks
          are cancelled and client requests waived. Filings not yet due, and lodged ones, stay.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Keep from
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPreview(null);
                setDone(null);
              }}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!month || run.isPending}
            onClick={() => {
              setDone(null);
              run.mutate(true);
            }}
          >
            {run.isPending && !preview ? 'Counting…' : 'Preview'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {preview && (
          <div className="rounded-lg border border-warning-500/30 bg-warning-50 p-3 text-warning-700">
            {preview.filings === 0 ? (
              <p>Nothing overdue before {label}.</p>
            ) : (
              <>
                <p>
                  {preview.filings} overdue filing{preview.filings === 1 ? '' : 's'} before {label}{' '}
                  will go Not applicable; {preview.tasks} open task{preview.tasks === 1 ? '' : 's'}{' '}
                  cancelled; {preview.requests} client request{preview.requests === 1 ? '' : 's'}{' '}
                  waived.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(false)}>
                    {run.isPending ? 'Clearing…' : `Clear before ${label}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {done && (
          <p className="text-success-700" role="status">
            {cleanupSummary(done, 'Removed')} Starting fresh from {label}.
          </p>
        )}
        {error && <p className="text-danger-700">{error}</p>}
      </CardBody>
    </Card>
  );
}
