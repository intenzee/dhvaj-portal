'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Undo2, X } from 'lucide-react';
import { PERMISSION, type ReversalKind, type ReversalRequest } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Field, Input } from '@/components/form';

/**
 * Spec §3.5 · voiding an issued invoice and reversing a receipt are a
 * partner's (billing.approve). Whoever bills without that permission (the
 * Accountant) asks; a partner other than the asker approves — the void or
 * reversal then happens — or rejects; the asker may take it back meanwhile.
 */

export const PENDING_REVERSALS_KEY = ['billing', 'reversal-requests', 'pending'] as const;

/** Every open request the caller may see: one list, looked up per row. */
export function usePendingReversals(enabled = true): ReversalRequest[] {
  const q = useQuery({
    queryKey: PENDING_REVERSALS_KEY,
    queryFn: () => apiFetch<ReversalRequest[]>('/billing/reversal-requests?status=pending'),
    enabled,
  });
  return q.data ?? [];
}

/** May ask (bills the client) but may not do it directly. */
export function mayAskReversal(principal: Parameters<typeof can>[0]): boolean {
  return can(principal, PERMISSION.billingManage) && !can(principal, PERMISSION.billingApprove);
}

function useInvalidate(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['billing'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

const NOUN: Record<ReversalKind, { ask: string; done: string; hint: string }> = {
  invoice_void: {
    ask: 'Why void it?',
    done: 'Asked a partner to void this invoice.',
    hint: 'A partner approves; the number stays taken and the invoice shows as void.',
  },
  receipt_reversal: {
    ask: 'Why reverse it?',
    done: 'Asked a partner to reverse this receipt.',
    hint: 'A bounced cheque, a wrong client… A partner approves; the invoices reopen.',
  },
};

/** "Ask to void" / "Ask to reverse", with the reason inline. */
export function AskReversal({
  kind,
  targetId,
  onDone,
}: {
  kind: ReversalKind;
  targetId: string;
  onDone?: () => void;
}): JSX.Element {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const ask = useMutation({
    mutationFn: () =>
      apiFetch<ReversalRequest>('/billing/reversal-requests', {
        method: 'POST',
        body: {
          kind,
          ...(kind === 'invoice_void' ? { invoiceId: targetId } : { receiptId: targetId }),
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      toast(NOUN[kind].done);
      setOpen(false);
      setReason('');
      invalidate();
      onDone?.();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not send the request.', 'error'),
  });

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4" /> {kind === 'invoice_void' ? 'Ask to void' : 'Ask to reverse'}
      </Button>
    );
  }
  return (
    <div className="mt-2 flex w-full items-end gap-2">
      <div className="flex-1">
        <Field label={NOUN[kind].ask} hint={NOUN[kind].hint}>
          <Input
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button size="sm" onClick={() => ask.mutate()} disabled={!reason.trim() || ask.isPending}>
        Send to partner
      </Button>
    </div>
  );
}

/** The open request on an invoice or receipt: who asked and why, and what the viewer may do. */
export function PendingReversal({ request }: { request: ReversalRequest }): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const mine = !!principal?.employeeId && request.requestedById === principal.employeeId;
  const mayDecide = can(principal, PERMISSION.billingApprove) && !mine;

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiFetch<ReversalRequest>(`/billing/reversal-requests/${request.id}/decision`, {
        method: 'POST',
        body: { decision, note: note.trim() || null, version: request.version },
      }),
    onSuccess: (q) => {
      toast(
        q.status === 'approved'
          ? q.kind === 'invoice_void'
            ? 'Approved: the invoice is void.'
            : 'Approved: the receipt is reversed and its invoices are open again.'
          : 'Rejected; nothing changed.',
      );
      invalidate();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not record the decision.', 'error'),
  });
  const withdraw = useMutation({
    mutationFn: () =>
      apiFetch<ReversalRequest>(`/billing/reversal-requests/${request.id}/withdraw`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast('Request taken back.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not take it back.', 'error'),
  });

  return (
    <div className="mt-2 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-ink-muted">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <span className="font-medium text-ink">
            {request.kind === 'invoice_void' ? 'Void asked' : 'Reversal asked'}
          </span>{' '}
          {request.requestedByName ? `by ${request.requestedByName}, ` : ''}
          {formatDate(request.at)}: {request.reason}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {mine && (
            <Button
              variant="ghost"
              size="sm"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              Take back
            </Button>
          )}
          {mayDecide && !rejecting && (
            <>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate('approve')}
              >
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
          )}
          {mayDecide && rejecting && (
            <>
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
            </>
          )}
        </span>
      </div>
    </div>
  );
}
