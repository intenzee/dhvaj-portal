'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TASK_STATUSES, type TaskStatus } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { MyTask } from '@/lib/types';

/** Inline status changer for a task — POSTs the transition, the backend enforces the rules. */
export function TaskStatusControl({ task }: { task: MyTask }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (status: TaskStatus) =>
      apiFetch(`/engagements/${task.engagementId}/tasks/${task.id}/status`, {
        method: 'POST',
        body: { status, version: task.version },
      }),
    onSuccess: (_data, status) => {
      toast(`Task marked "${humanize(status)}".`);
      qc.invalidateQueries({ queryKey: ['work'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['engagement', task.engagementId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the task.', 'error'),
  });

  return (
    <select
      value={task.status}
      disabled={mutation.isPending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => mutation.mutate(e.target.value as TaskStatus)}
      className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-medium text-ink focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {humanize(s)}
        </option>
      ))}
    </select>
  );
}
