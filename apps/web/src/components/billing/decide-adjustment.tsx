'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { InvoiceAdjustment, TodayAdjustment } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Input } from '@/components/form';
import { adjustmentKindLabel } from './adjustments';

/**
 * PS-205 · Approve or reject a write-off or credit note in place (the Today
 * row). Rejecting asks for an optional note first.
 */
export function DecideAdjustmentButtons({
  adjustment,
  listKey,
}: {
  adjustment: Pick<TodayAdjustment, 'id' | 'kind' | 'version'>;
  listKey: readonly unknown[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const path = adjustment.kind === 'write_off' ? 'write-offs' : 'credit-notes';
  const noun = adjustmentKindLabel(adjustment.kind);

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiFetch<InvoiceAdjustment>(`/billing/${path}/${adjustment.id}/decision`, {
        method: 'POST',
        body: { decision, note: note.trim() || null, version: adjustment.version },
      }),
    onSuccess: (a) => {
      toast(
        a.status === 'approved'
          ? `${noun} approved${a.number ? ` as ${a.number}` : ''}; the invoice balance is reduced.`
          : `${noun} rejected; the invoice is unchanged.`,
      );
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not record the decision.', 'error'),
  });

  if (rejecting) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          className="w-48"
          placeholder="Why not? (optional)"
          aria-label="Why reject it"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={decide.isPending}
          onClick={() => decide.mutate('reject')}
        >
          Reject
        </Button>
      </div>
    );
  }
  return (
    <>
      <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
        <Check className="h-4 w-4" /> Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={decide.isPending}
        onClick={() => setRejecting(true)}
      >
        <X className="h-4 w-4" /> Reject
      </Button>
    </>
  );
}
