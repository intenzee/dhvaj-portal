'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ClockState, TaskAction } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Input } from '@/components/form';
import {
  ACTIONS_NEEDING_REASON,
  TASK_ACTION_LABEL,
  availableTaskActions,
  type TaskActionContext,
  type WorkTask,
} from '@/lib/work-types';

const PRIMARY: TaskAction[] = ['start', 'send-for-review', 'start-review', 'approve'];

/**
 * Change 3 — the task's next moves as buttons (Start work, Pause, Send for
 * review …). Moving the task is what runs the clock; nobody presses a timer.
 * Return and Waiting on client ask for a reason inline, under the buttons.
 */
export function TaskActions({
  task,
  ctx,
  onDone,
}: {
  task: WorkTask;
  ctx: TaskActionContext;
  onDone?: () => void;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState<TaskAction | null>(null);
  const [reason, setReason] = useState('');
  const actions = availableTaskActions(task, ctx);

  const run = useMutation({
    mutationFn: ({ action, why }: { action: TaskAction; why?: string }) =>
      apiFetch<ClockState>(`/engagements/${task.engagementId}/tasks/${task.id}/${action}`, {
        method: 'POST',
        body: { version: task.version, ...(why ? { reason: why } : {}) },
      }),
    onSuccess: (_clock, { action }) => {
      toast(`${task.title}: ${TASK_ACTION_LABEL[action].toLowerCase()}.`);
      setAsking(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['engagement', task.engagementId] });
      void qc.invalidateQueries({ queryKey: ['work'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['filing'] });
      void qc.invalidateQueries({ queryKey: ['time', 'clock'] });
      onDone?.();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not move the task.', 'error'),
  });

  if (actions.length === 0) return null;
  const click = (a: TaskAction) => {
    if (ACTIONS_NEEDING_REASON.includes(a)) {
      setAsking(asking === a ? null : a);
      return;
    }
    run.mutate({ action: a });
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={PRIMARY.includes(a) ? 'primary' : a === 'cancel' ? 'ghost' : 'secondary'}
            disabled={run.isPending}
            aria-expanded={ACTIONS_NEEDING_REASON.includes(a) ? asking === a : undefined}
            onClick={() => click(a)}
          >
            {TASK_ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      {asking && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) run.mutate({ action: asking, why: reason.trim() });
          }}
        >
          <Input
            autoFocus
            className="min-w-[16rem] flex-1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={asking === 'return' ? 'Review points for the preparer' : 'What is needed from the client'}
            aria-label={asking === 'return' ? 'Review points' : 'What is needed from the client'}
          />
          <Button size="sm" type="submit" disabled={!reason.trim() || run.isPending}>
            {TASK_ACTION_LABEL[asking]}
          </Button>
        </form>
      )}
    </div>
  );
}
