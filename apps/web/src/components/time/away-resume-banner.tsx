'use client';

import { useMutation } from '@tanstack/react-query';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useHeartbeat } from '@/lib/use-heartbeat';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Change 3 — keeps the automatic clock alive (heartbeat) and, when the server
 * closed the caller's entry for inactivity or day-end, offers "You were away
 * from 15:10 — resume?". Renders nothing unless ff_auto_time is on.
 */
export function AwayResumeBanner(): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const enabled = isOn(FEATURE_FLAG.autoTime);
  const { clock, dismiss, refresh } = useHeartbeat(enabled);
  const toast = useToast();
  const resume = useMutation({
    mutationFn: (r: { engagementId: string; taskId: string }) =>
      apiFetch(`/engagements/${r.engagementId}/tasks/${r.taskId}/start`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Resumed — your clock is running again.');
      refresh();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not resume the task.', 'error'),
  });

  const r = clock?.resumable;
  if (!enabled || !r) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-500/30 bg-warning-50 px-2.5 py-1 text-xs text-warning-700"
    >
      <span>
        You were away from {timeOf(r.awaySince)} — resume <strong>{r.taskTitle}</strong>?
      </span>
      <Button
        size="sm"
        disabled={resume.isPending}
        onClick={() => resume.mutate({ engagementId: r.engagementId, taskId: r.taskId })}
      >
        Resume
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Not now
      </Button>
    </div>
  );
}
