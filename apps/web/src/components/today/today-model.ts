import type { TodayItem, TodayView } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { WorkTask } from '@/lib/work-types';
import { drawerItemsFrom, type DrawerItem } from '@/components/filing/filing-drawer';

/**
 * WF-201 / WF-204 — Today's data and the pure helpers its screens share (the
 * Today page and the engagement's Next up strip). Tested.
 */

/** Today's query; under ['work'] so every task move refreshes it. */
export function todayQuery(engagementId?: string): {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TodayView>;
} {
  return {
    queryKey: engagementId ? ['work', 'today', engagementId] : ['work', 'today'],
    queryFn: () =>
      apiFetch<TodayView>(
        engagementId
          ? `/work/today?engagementId=${encodeURIComponent(engagementId)}`
          : '/work/today',
      ),
  };
}

/** Every row in display order (group by group). */
export function todayRows(view: TodayView | undefined): TodayItem[] {
  return view ? view.groups.flatMap((g) => g.items) : [];
}

/** The filings the drawer walks with Previous / Next: each once, in display order. */
export function todayDrawerItems(
  rows: readonly TodayItem[],
  hrefOf: (i: TodayItem) => string,
): DrawerItem[] {
  return drawerItemsFrom(rows, (i) => `${i.title} · ${i.entityName}`, hrefOf);
}

/**
 * The row's second line: client, then the filing (form · period ·
 * registration), the notice's type, or the engagement.
 */
export function todayContextLine(i: TodayItem): string {
  if (i.notice) {
    // The title already leads with part of the type ("Scrutiny assessment · ref"): don't say it twice.
    const named = new Set(i.title.split(' · '));
    const type = i.notice.typeLabel
      .split(' · ')
      .filter((p) => !named.has(p))
      .join(' · ');
    return [i.entityName, type, i.engagementCode].filter(Boolean).join(' · ');
  }
  if (i.adjustment) {
    const by = i.adjustment.requestedByName ? `${i.adjustment.requestedByName}: ` : '';
    return `${i.entityName} · ${by}${i.adjustment.reason}`;
  }
  const what = i.filing
    ? [i.filing.formLabel, i.filing.periodLabel, i.filing.registrationNumber]
        .filter(Boolean)
        .join(' · ')
    : i.engagementCode;
  return `${i.entityName} · ${what}`;
}

/** The row's task as the shared action buttons expect it, or null with no task. */
export function todayWorkTask(i: TodayItem): WorkTask | null {
  const t = i.task;
  if (!t) return null;
  return {
    id: t.id,
    engagementId: i.engagementId,
    title: t.title || i.title,
    description: null,
    status: t.status,
    priority: 'normal',
    dueDate: i.internalDate,
    isOverdue: i.isOverdue,
    blockedByOpenCount: i.blockedByOpenCount,
    assignedToId: t.assignedToId,
    assignedToName: t.assignedToName,
    engagementServiceId: null,
    stream: i.link.stream ?? null,
    reviewerId: t.reviewerId,
    reviewerName: t.reviewerName,
    workType: i.filing ? 'filing' : null,
    complianceInstanceId: i.filing?.instanceId ?? null,
    sentForReviewAt: t.sentForReviewAt,
    reviewStartedAt: t.reviewStartedAt,
    version: t.version,
  };
}

/** j / k: the next selected row, clamped to the list (none selected → the first). */
export function stepSelection(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/** The date cell's lead-in: a notice's row says which date it is (Reply due / Hearing / Appeal by). */
export function todayDateLead(i: TodayItem): string | null {
  if (i.adjustment) return 'Asked';
  return i.notice ? i.notice.clockLabel : null;
}
