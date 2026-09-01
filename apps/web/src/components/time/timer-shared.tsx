'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ActiveTimer } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatClock, secondsSince } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

/**
 * Shared plumbing for the engagement time tracker (ADR-0034): the caller's
 * single running timer, a once-a-second ticker, a live clock, and the stop
 * mutation. Reused by the engagement Time tab and the global running-timer
 * banner so the stopwatch behaves identically wherever it appears.
 */

const ACTIVE_KEY = ['active-timer'] as const;

/** The caller's currently running timer (polled), or null. */
export function useActiveTimer(): ReturnType<typeof useQuery<ActiveTimer | null>> {
  return useQuery({
    queryKey: ACTIVE_KEY,
    // No running timer serialises to an empty body → apiFetch yields `undefined`,
    // which TanStack Query rejects (it would keep the previous, stale timer and
    // the banner would never clear on stop). Coerce to `null` so the cache
    // actually updates to "no timer".
    queryFn: async () => (await apiFetch<ActiveTimer | null>('/engagements/time/active')) ?? null,
    // A timer runs for minutes/hours; a slow poll is enough to catch changes
    // made in another tab. The visible clock ticks locally every second.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** Re-render every second while `on` is true (drives the live clock). */
export function useSecondTick(on: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

/** A monospaced clock counting up from an ISO start time. */
export function LiveClock({ startedAt }: { startedAt: string }): JSX.Element {
  useSecondTick(true);
  return <span className="tabular-nums">{formatClock(secondsSince(startedAt))}</span>;
}

/** Invalidate every query the time tracker feeds. */
export function invalidateTime(qc: QueryClient, engagementId?: string): void {
  qc.invalidateQueries({ queryKey: ACTIVE_KEY });
  qc.invalidateQueries({ queryKey: ['reports', 'time'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  if (engagementId) {
    qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'time'] });
  }
}

/** Stop the caller's running timer on an engagement. */
export function StopTimerButton({
  engagementId,
  size = 'sm',
  variant = 'secondary',
  label = 'Stop',
}: {
  engagementId: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  label?: string;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const stop = useMutation({
    mutationFn: () => apiFetch(`/engagements/${engagementId}/time/stop`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Timer stopped.');
      invalidateTime(qc, engagementId);
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not stop the timer.', 'error'),
  });
  return (
    <Button size={size} variant={variant} disabled={stop.isPending} onClick={() => stop.mutate()}>
      {stop.isPending ? 'Stopping…' : label}
    </Button>
  );
}
