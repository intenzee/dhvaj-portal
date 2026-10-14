'use client';

import type { ActiveTimer } from '@hsdg/contracts';
import { LiveClock, useActiveTimer } from '@/components/time/timer-shared';

/** Is the caller's running clock on this filing? Pure — tested. */
export function clockIsOn(timer: ActiveTimer | null | undefined, instanceId: string): boolean {
  return !!timer && timer.link?.instanceId === instanceId;
}

/**
 * WF-205: the drawer shows the clock while it runs on the open filing — Start
 * work opens it, Send for review stops it, Start review opens the reviewer's —
 * so nobody has to look up at the top bar to know they are being timed.
 */
export function FilingClock({ instanceId }: { instanceId: string }): JSX.Element | null {
  const { data } = useActiveTimer();
  if (!data || !clockIsOn(data, instanceId)) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-success-200 bg-success-50 px-2 py-0.5 font-mono text-xs font-semibold text-success-800"
      title={data.entry.entryKind === 'review' ? 'Timing your review' : 'Timing your work'}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden />
      <span className="sr-only">Timing this filing: </span>
      <LiveClock startedAt={data.entry.startedAt} />
    </span>
  );
}
