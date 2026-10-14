'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { compareTodayItems, FEATURE_FLAG, type TodayItem, type TodayView } from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { deadlineLabel } from '@/lib/format';
import { useWorkHref } from '@/lib/work-href';
import { todayQuery, todayRows } from './today-model';

/** My next `n` items across Today's groups: overdue first, then by internal date. Pure — tested. */
export function nextUp(view: TodayView | undefined, n = 3): TodayItem[] {
  return [...todayRows(view)].sort(compareTodayItems).slice(0, n);
}

/**
 * Staff Workflow WF-204 — "Next up for you": a slim strip under the engagement
 * header with my next three open items on it (Today, filtered to this
 * engagement), each a link to the work itself. Hidden when there are none.
 */
export function NextUpStrip({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.todayView);
  const q = useQuery({ ...todayQuery(engagementId), enabled: on });
  const workHref = useWorkHref();
  const items = nextUp(q.data);
  if (!on || items.length === 0) return null;

  return (
    <nav
      aria-label="Next up for you"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-primary-800">
        Next up for you
      </span>
      {items.map((i) => (
        <Link
          key={i.key}
          href={workHref(i)}
          className="inline-flex min-w-0 items-baseline gap-1.5 text-sm font-medium text-ink hover:underline"
        >
          <span className="max-w-[18rem] truncate">{i.title}</span>
          {i.internalDate && (
            <span
              className={
                i.isOverdue ? 'text-xs font-medium text-danger-600' : 'text-xs text-ink-faint'
              }
            >
              {deadlineLabel(i.internalDate)}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
