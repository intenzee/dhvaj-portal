'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveTimer, ClockState, Paginated, TaskAction } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Input, Select } from '@/components/form';
import type { EmployeeRow } from '@/lib/types';
import {
  ACTIONS_NEEDING_REASON,
  TASK_ACTION_LABEL,
  taskActionLabel,
  availableTaskActions,
  needsReviewerPick,
  reasonRequired,
  type TaskActionContext,
  type WorkTask,
} from '@/lib/work-types';

/** Each state's main move forward — what a list row offers (Today, WF-201). */
export const PRIMARY: TaskAction[] = ['start', 'send-for-review', 'start-review', 'approve'];

/**
 * WF-205: one clock at a time — starting this task (or its review) paused
 * whatever was running on another task. Name it, so the switch is never silent.
 * Pure — tested.
 */
export function pausedByStart(
  action: TaskAction,
  taskId: string,
  before: ActiveTimer | null | undefined,
): string | null {
  if (action !== 'start' && action !== 'start-review') return null;
  if (!before || before.entry.taskId === taskId) return null;
  return before.entry.taskTitle ?? before.engagementCode;
}

/**
 * Change 3 — the task's next moves as buttons (Start work, Pause, Send for
 * review …). Moving the task is what runs the clock; nobody presses a timer.
 * Return and Waiting on client ask for a reason inline, under the buttons
 * (required only while the firm's task_reasons_required check is on). With
 * review optional, Send for review on a task with no reviewer asks who.
 */
export function TaskActions({
  task,
  ctx,
  onDone,
  only,
}: {
  task: WorkTask;
  ctx: TaskActionContext;
  onDone?: () => void;
  /** Offer only these moves (a list row keeps to the main one; the filing has the rest). */
  only?: readonly TaskAction[];
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState<TaskAction | null>(null);
  const [reason, setReason] = useState('');
  const [reviewer, setReviewer] = useState('');
  const actions = availableTaskActions(task, ctx).filter((a) => !only || only.includes(a));
  const pickReviewer = needsReviewerPick(task, ctx);
  const people = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100&status=active'),
    enabled: asking === 'send-for-review',
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: ({ action, why, by }: { action: TaskAction; why?: string; by?: string }) =>
      apiFetch<ClockState & { warnings?: string[] }>(
        `/engagements/${task.engagementId}/tasks/${task.id}/${action}`,
        {
          method: 'POST',
          body: {
            version: task.version,
            ...(why ? { reason: why } : {}),
            ...(by ? { reviewerEmployeeId: by } : {}),
          },
        },
      ),
    // Returning the refetch keeps the mutation pending (buttons disabled) until
    // the lists hold the task's new version, so a quick second click (Start
    // review → Approve) never sends the stale one and hits a version conflict.
    onSuccess: async (result, { action }) => {
      // The banner's cache still holds the clock as it was before this move.
      const paused = pausedByStart(
        action,
        task.id,
        qc.getQueryData<ActiveTimer | null>(['active-timer']),
      );
      toast(
        `${task.title}: ${taskActionLabel(action, task.status).toLowerCase()}.` +
          (paused ? ` Paused ${paused}.` : ''),
      );
      // A check that is off let this through; say what was off.
      for (const w of result?.warnings ?? []) toast(w, 'warning');
      setAsking(null);
      setReason('');
      setReviewer('');
      onDone?.();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['engagement', task.engagementId] }),
        qc.invalidateQueries({ queryKey: ['work'] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['filing'] }),
        qc.invalidateQueries({ queryKey: ['time', 'clock'] }),
        qc.invalidateQueries({ queryKey: ['active-timer'] }),
      ]);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not move the task.', 'error'),
  });

  if (actions.length === 0) return null;
  const mustSay = asking ? reasonRequired(asking, ctx) : false;
  const asksFirst = (a: TaskAction) =>
    ACTIONS_NEEDING_REASON.includes(a) || (a === 'send-for-review' && pickReviewer);
  const click = (a: TaskAction) => {
    if (asksFirst(a)) {
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
            aria-expanded={asksFirst(a) ? asking === a : undefined}
            onClick={() => click(a)}
          >
            {taskActionLabel(a, task.status)}
          </Button>
        ))}
      </div>
      {asking === 'send-for-review' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reviewer) run.mutate({ action: asking, by: reviewer });
          }}
        >
          <Select
            autoFocus
            className="min-w-[16rem] flex-1"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            aria-label="Who should review"
          >
            <option value="">{people.isLoading ? 'Loading…' : 'Who should review?'}</option>
            {(people.data?.items ?? [])
              .filter((p) => p.id !== task.assignedToId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} · {p.gradeName}
                </option>
              ))}
          </Select>
          <Button size="sm" type="submit" disabled={!reviewer || run.isPending}>
            {TASK_ACTION_LABEL[asking]}
          </Button>
        </form>
      )}
      {asking && asking !== 'send-for-review' && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim() || !mustSay) run.mutate({ action: asking, why: reason.trim() });
          }}
        >
          <Input
            autoFocus
            className="min-w-[16rem] flex-1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              (asking === 'return'
                ? 'Review points for the preparer'
                : 'What is needed from the client') + (mustSay ? '' : ' (optional)')
            }
            aria-label={asking === 'return' ? 'Review points' : 'What is needed from the client'}
          />
          <Button size="sm" type="submit" disabled={(mustSay && !reason.trim()) || run.isPending}>
            {TASK_ACTION_LABEL[asking]}
          </Button>
        </form>
      )}
    </div>
  );
}
