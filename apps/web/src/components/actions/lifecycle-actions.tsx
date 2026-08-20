'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasRole } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { EngagementDetail } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Textarea } from '@/components/form';

interface ActionDef {
  action: string;
  label: string;
  variant?: 'primary' | 'secondary';
  needsReason?: boolean;
  mpOnly?: boolean;
}

/** Valid lifecycle actions per status (the backend state machine is authoritative). */
const ACTIONS: Record<string, ActionDef[]> = {
  prospect: [
    { action: 'submit-for-acceptance', label: 'Submit for acceptance', variant: 'primary' },
    { action: 'decline', label: 'Decline', needsReason: true },
  ],
  pending_acceptance: [
    { action: 'accept', label: 'Accept', variant: 'primary' },
    { action: 'decline', label: 'Decline', needsReason: true },
    { action: 'withdraw', label: 'Withdraw', needsReason: true },
  ],
  accepted: [
    { action: 'start', label: 'Start work', variant: 'primary' },
    { action: 'cancel', label: 'Cancel', needsReason: true },
  ],
  active: [
    { action: 'complete', label: 'Complete', variant: 'primary' },
    { action: 'put-on-hold', label: 'Put on hold', needsReason: true },
  ],
  on_hold: [
    { action: 'resume', label: 'Resume', variant: 'primary' },
    { action: 'cancel', label: 'Cancel', needsReason: true },
  ],
  completed: [
    { action: 'close', label: 'Close', variant: 'primary' },
    { action: 'reopen', label: 'Reopen', needsReason: true, mpOnly: true },
  ],
  closed: [{ action: 'reopen', label: 'Reopen', needsReason: true, mpOnly: true }],
};

export function LifecycleActions({ engagement }: { engagement: EngagementDetail }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const [reasonFor, setReasonFor] = useState<ActionDef | null>(null);
  const [reason, setReason] = useState('');

  const run = useMutation({
    mutationFn: (input: { action: string; reason?: string }) =>
      apiFetch(`/engagements/${engagement.id}/${input.action}`, {
        method: 'POST',
        body: { version: engagement.version, ...(input.reason ? { reason: input.reason } : {}) },
      }),
    onSuccess: (_d, input) => {
      toast(`Engagement ${input.action.replace(/-/g, ' ')} done.`);
      qc.invalidateQueries({ queryKey: ['engagement', engagement.id] });
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setReasonFor(null);
      setReason('');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'That transition was rejected.', 'error'),
  });

  const isMp = hasRole(principal, 'managing_partner');
  const available = (ACTIONS[engagement.status] ?? []).filter((a) => !a.mpOnly || isMp);
  if (available.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {available.map((a) => (
          <Button
            key={a.action}
            size="sm"
            variant={a.variant ?? 'secondary'}
            disabled={run.isPending}
            onClick={() => (a.needsReason ? setReasonFor(a) : run.mutate({ action: a.action }))}
          >
            {a.label}
          </Button>
        ))}
      </div>

      <Modal
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        title={reasonFor?.label ?? ''}
        description="A reason is recorded on the audit trail."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length === 0 || run.isPending}
              onClick={() => reasonFor && run.mutate({ action: reasonFor.action, reason: reason.trim() })}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why…" />
        </Field>
      </Modal>
    </>
  );
}
