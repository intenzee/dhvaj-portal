'use client';

import Link from 'next/link';
import { LiveClock, StopTimerButton, useActiveTimer } from './timer-shared';

/**
 * Always-visible pill in the top bar showing the caller's running timer (ADR-
 * 0034). Because the stopwatch never auto-stops — work happens outside the
 * portal — this keeps a running timer in view everywhere so it isn't forgotten.
 * Renders nothing when no timer is running.
 */
export function RunningTimerBanner(): JSX.Element | null {
  const { data } = useActiveTimer();
  if (!data) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50 px-2 py-1 sm:px-2.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
      </span>
      <Link
        href={`/engagements/${data.entry.engagementId}`}
        className="hidden text-xs font-semibold text-success-800 hover:underline sm:inline"
        title={`Timing ${data.engagementCode} · ${data.entityName}`}
      >
        {data.engagementCode}
      </Link>
      <span className="font-mono text-xs font-semibold text-success-800">
        <LiveClock startedAt={data.entry.startedAt} />
      </span>
      <StopTimerButton engagementId={data.entry.engagementId} size="sm" label="Stop" />
    </div>
  );
}
