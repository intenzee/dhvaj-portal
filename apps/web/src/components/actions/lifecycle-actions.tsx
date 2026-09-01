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
import { LiveClock, invalidateTime, useActiveTimer } from '@/components/time/timer-shared';

/**
 * Actions that end the engagement — closing while your timer runs prompts a stop.
 * Must mirror the server's TERMINAL_STATUSES in engagement-lifecycle.service.ts
 * (which force-stops timers): complete→completed, close→closed, cancel→cancelled,
 * withdraw→withdrawn, decline→declined.
 */
const CLOSING_ACTIONS = new Set(['complete', 'close', 'cancel', 'withdraw', 'decline']);

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
  const [timerPromptFor, setTimerPromptFor] = useState<ActionDef | null>(null);

  const active = useActiveTimer();
  const runningHere = active.data?.entry.engagementId === engagement.id ? active.data : null;

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
      // A terminal transition force-stops running timers server-side, so refresh
      // the timer/report views too.
      invalidateTime(qc, engagement.id);
      setReasonFor(null);
      setReason('');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'That transition was rejected.', 'error'),
  });

  const stopTimer = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagement.id}/time/stop`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateTime(qc, engagement.id),
  });

  // Move an action forward: reason-required actions open the reason modal first.
  const proceed = (a: ActionDef): void => {
    if (a.needsReason) setReasonFor(a);
    else run.mutate({ action: a.action });
  };

  // Clicking a closing action while your timer runs here prompts you to stop it.
  const onAction = (a: ActionDef): void => {
    if (CLOSING_ACTIONS.has(a.action) && runningHere) {
      setTimerPromptFor(a);
      return;
    }
    proceed(a);
  };

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
            disabled={run.isPending || stopTimer.isPending}
            onClick={() => onAction(a)}
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

      {/* Running-timer prompt on close (ADR-0034). */}
      <Modal
        open={!!timerPromptFor}
        onClose={() => setTimerPromptFor(null)}
        title="You have a timer running"
        description="Stop your timer before this engagement is closed?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTimerPromptFor(null)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              disabled={run.isPending || stopTimer.isPending}
              onClick={() => {
                const a = timerPromptFor;
                setTimerPromptFor(null);
                if (a) proceed(a);
              }}
            >
              Continue without stopping
            </Button>
            <Button
              disabled={run.isPending || stopTimer.isPending}
              onClick={async () => {
                const a = timerPromptFor;
                setTimerPromptFor(null);
                await stopTimer.mutateAsync().catch(() => undefined);
                if (a) proceed(a);
              }}
            >
              Stop timer &amp; continue
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Your timer has been running for{' '}
          {runningHere && (
            <span className="font-mono font-semibold text-ink">
              <LiveClock startedAt={runningHere.entry.startedAt} />
            </span>
          )}
          . Closing the engagement stops any running timers automatically, but you can stop yours
          now to record it as a manual stop.
        </p>
      </Modal>
    </>
  );
}
