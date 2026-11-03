import {
  TODAY_GROUP,
  TODAY_GROUP_LIMIT,
  TODAY_GROUPS,
  WORK_REVIEW_TYPE,
  compareTodayItems,
  isPastDate,
  todayDueDate,
  type TodayGroup,
  type TodayItem,
  type TodayView,
  type WorkReviewItem,
} from '@hsdg/contracts';

/**
 * WF-201 — the pure half of Today: a review-queue item as a Today row, and the
 * grouping (dedupe + order). DI-free, so the rules are unit-tested without a
 * database; work-today.service.ts feeds it.
 */

/** A WF-105 queue item as a "To review" row (`me` is its reviewer). */
export function reviewToToday(r: WorkReviewItem, today: string, me: string): TodayItem {
  const base = {
    group: TODAY_GROUP.review,
    title: r.title,
    engagementId: r.engagementId,
    engagementCode: r.engagementCode,
    engagementKind: r.engagementKind,
    entityName: r.entityName,
    blockedByOpenCount: 0,
    link: r.link,
  };
  if (r.type === WORK_REVIEW_TYPE.filingReview) {
    return {
      ...base,
      key: `task:${r.taskId}`,
      kind: 'task',
      filing: r.filing,
      internalDate: r.internalDate,
      statutoryDate: r.statutoryDate,
      status: 'in_review',
      isOverdue: isPastDate(todayDueDate(r), today),
      task: {
        id: r.taskId,
        title: r.title,
        status: 'in_review',
        version: r.taskVersion,
        assignedToId: r.preparerId,
        assignedToName: r.preparerName,
        reviewerId: me,
        reviewerName: null,
        sentForReviewAt: r.waitingSince,
        reviewStartedAt: r.reviewStartedAt,
      },
    };
  }
  return {
    ...base,
    key: `${r.type}:${r.id}`,
    kind: r.type,
    filing: null,
    internalDate: null,
    statutoryDate: null,
    status: r.type === WORK_REVIEW_TYPE.signOff ? 'awaiting_sign_off' : 'open',
    isOverdue: false,
    task: null,
  };
}

/**
 * Today's rows by group; `notices` is absent (and the group left out) when
 * ff_notices is off, and `write_offs` when ff_billing_v2 is off or the caller
 * cannot approve.
 */
export type TodayRows = Record<
  Exclude<TodayGroup, 'notices' | 'write_offs' | 'overdue' | 'due_today'>,
  TodayItem[]
> & {
  notices?: TodayItem[];
  write_offs?: TodayItem[];
};

/** Groups whose rows due today or past move up to Overdue / Due today. */
const LIFTED: readonly TodayGroup[] = [TODAY_GROUP.prepare, TODAY_GROUP.dueSoon];

/**
 * The groups, each in Today's order. A filing already on a row above (its
 * task to prepare, review or chase) is not repeated under "Due this week".
 * Rows to prepare and filings due that are past their due date or due today
 * lead the day as Overdue and Due today (kept as they are, group aside).
 */
export function buildTodayView(today: string, rows: TodayRows, engagementId?: string): TodayView {
  const keep = (items: TodayItem[]): TodayItem[] =>
    engagementId ? items.filter((i) => i.engagementId === engagementId) : items;
  const listed = new Set<string>();
  for (const g of [TODAY_GROUP.prepare, TODAY_GROUP.review, TODAY_GROUP.waiting] as const) {
    for (const i of keep(rows[g])) if (i.link.instanceId) listed.add(i.link.instanceId);
  }
  const byGroup: Partial<Record<TodayGroup, TodayItem[]>> = {
    [TODAY_GROUP.overdue]: [],
    [TODAY_GROUP.dueToday]: [],
  };
  for (const group of TODAY_GROUPS) {
    const own = (rows as Partial<Record<TodayGroup, TodayItem[]>>)[group];
    if (!own) continue;
    let items = keep(own);
    if (group === TODAY_GROUP.dueSoon) {
      items = items.filter((i) => !i.link.instanceId || !listed.has(i.link.instanceId));
    }
    const stay: TodayItem[] = [];
    for (const i of items) {
      const due = LIFTED.includes(group) ? todayDueDate(i) : null;
      if (due !== null && due < today) byGroup.overdue!.push({ ...i, group: TODAY_GROUP.overdue });
      else if (due === today) byGroup.due_today!.push({ ...i, group: TODAY_GROUP.dueToday });
      else stay.push(i);
    }
    byGroup[group] = stay;
  }
  const groups = TODAY_GROUPS.flatMap((group) => {
    const own = byGroup[group];
    if (!own) return [];
    const items = [...own].sort(compareTodayItems);
    return [{ group, items: items.slice(0, TODAY_GROUP_LIMIT), total: items.length }];
  });
  return { today, groups };
}
