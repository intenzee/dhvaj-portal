import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuickTaskDetail, QuickTaskReplyInput, QuickTaskStatus } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

export const QUICK_TASK_KEYS = {
  all: ['quick-tasks'] as const,
  inbox: ['quick-tasks', 'inbox'] as const,
  people: ['quick-tasks', 'people'] as const,
  one: (id: string) => ['quick-tasks', 'one', id] as const,
};

/** Answer a quick task, then refresh every quick-task view. */
export function useQuickTaskReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickTaskReplyInput) =>
      apiFetch<QuickTaskDetail>(`/quick-tasks/${id}/reply`, { method: 'POST', body: input }),
    onSuccess: (detail) => {
      qc.setQueryData(QUICK_TASK_KEYS.one(id), detail);
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.all });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** "3:30 pm", or "Thu 5 Nov, 1:00 pm" when not today. Pure — tested. */
export function quickTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) =>
    x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const time = d
    .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  if (day(d) === day(now)) return time;
  const weekday = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  return `${weekday} ${day(d)}, ${time}`;
}

export const STATUS_TONE: Record<QuickTaskStatus, string> = {
  sent: 'warn',
  received: 'info',
  doing: 'info',
  done: 'success',
  cancelled: 'neutral',
};
