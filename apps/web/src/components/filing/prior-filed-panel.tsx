'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STREAM_LABEL, type PriorFiledResult, type Stream } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { todayIst } from '@/components/work/my-task-columns';
import { Button } from '@/components/ui';
import { PriorFiledPicker } from './prior-filed-picker';

/**
 * "Filed before the portal" on a stream tab (lead only), opening in place:
 * tick the periods the client filed before the portal and mark them filed —
 * or put back ones marked so by mistake. Lodged filings are never touched.
 */
export function PriorFiledPanel({
  engagementId,
  stream,
  financialYear,
  onDone,
}: {
  engagementId: string;
  stream: Stream;
  financialYear: string;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tokens, setTokens] = useState<string[]>([]);
  const run = useMutation({
    mutationFn: (undo: boolean) =>
      apiFetch<PriorFiledResult>(
        `/engagements/${engagementId}/streams/${stream}/prior-filed${undo ? '/undo' : ''}`,
        { method: 'POST', body: { periods: tokens } },
      ),
    onSuccess: (r, undo) => {
      const n = r.filings;
      toast(
        n === 0
          ? undo
            ? 'Nothing to put back — none of those were marked filed before the portal.'
            : 'Nothing to mark — those periods are already closed.'
          : undo
            ? `${n} filing${n === 1 ? '' : 's'} put back.`
            : `${n} filing${n === 1 ? '' : 's'} marked filed before the portal.`,
      );
      void qc.invalidateQueries({ queryKey: ['filing', 'tree', engagementId] });
      if (n > 0) {
        setTokens([]);
        onDone();
      }
    },
  });

  return (
    <div
      data-panel="prior-filed"
      className="space-y-3 rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface p-3"
    >
      <p className="text-sm text-ink">
        Which {STREAM_LABEL[stream]} periods did the client file before the portal? They are marked
        filed (no lodgement here) and stop showing overdue.
      </p>
      <PriorFiledPicker
        stream={stream}
        financialYears={[financialYear]}
        value={tokens}
        onChange={setTokens}
        today={todayIst()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={tokens.length === 0 || run.isPending}
          onClick={() => run.mutate(false)}
        >
          {run.isPending && !run.variables ? 'Marking…' : 'Mark filed'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={tokens.length === 0 || run.isPending}
          onClick={() => run.mutate(true)}
        >
          Put back
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Close
        </Button>
        {run.error && (
          <span className="text-xs text-danger-700">
            {run.error instanceof ApiError ? run.error.message : 'Could not save.'}
          </span>
        )}
      </div>
    </div>
  );
}
