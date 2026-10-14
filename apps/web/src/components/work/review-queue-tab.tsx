'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { FilingReviewItem, WorkReviewItem, WorkReviewType } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useWorkHref } from '@/lib/work-href';
import type { WorkTask } from '@/lib/work-types';
import { Badge, Card, Spinner } from '@/components/ui';
import { DataTable } from '@/components/data-table';
import { TaskActions } from '@/components/tasks/task-actions';
import {
  daysWaitingLabel,
  reviewItemContext,
  reviewQueueQuery,
} from '@/components/dashboard/review-queue';
import { cn } from '@/lib/cn';

export type ReviewFilter = 'all' | WorkReviewType;

const FILTERS: [ReviewFilter, string][] = [
  ['all', 'All'],
  ['filing_review', 'Filings'],
  ['review_point', 'Review points'],
  ['sign_off', 'Sign-offs'],
];

const TYPE_BADGE: Record<WorkReviewType, { label: string; tone: string }> = {
  filing_review: { label: 'Review', tone: 'info' },
  review_point: { label: 'Review point', tone: 'warn' },
  sign_off: { label: 'Sign-off', tone: 'success' },
};

/**
 * The filter a link asks for. Old /reviews links carry ?filter=signoff or
 * ?filter=high-risk (review points); the tab's own chips use the item types.
 * Pure — tested.
 */
export function reviewFilterOf(param: string | null): ReviewFilter {
  if (param === 'signoff' || param === 'sign_off') return 'sign_off';
  if (param === 'high-risk' || param === 'review' || param === 'review_point')
    return 'review_point';
  if (param === 'filing_review') return 'filing_review';
  return 'all';
}

/** The queue item as the task the shared action buttons expect (a review is in_review). */
export function reviewTask(item: FilingReviewItem, me: string | null): WorkTask {
  return {
    id: item.taskId,
    engagementId: item.engagementId,
    title: item.title,
    description: null,
    status: 'in_review',
    priority: 'normal',
    dueDate: item.dueDate,
    isOverdue: false,
    blockedByOpenCount: 0,
    assignedToId: item.preparerId,
    assignedToName: item.preparerName,
    engagementServiceId: null,
    stream: item.link.stream ?? null,
    reviewerId: me,
    reviewerName: null,
    workType: item.filing ? 'filing' : null,
    complianceInstanceId: item.filing?.instanceId ?? null,
    sentForReviewAt: item.waitingSince,
    reviewStartedAt: item.reviewStarted ? item.waitingSince : null,
    version: item.taskVersion,
  };
}

/**
 * My Work → "To review" (Staff Workflow WF-105): everything waiting for my
 * review — filings sent to me, review points to clear, sign-offs — oldest
 * first, each row opening the work itself. A filing can be reviewed from the
 * row; the shared query keeps Home's panel and the sidebar badge in step.
 */
export function ReviewQueueTab({ initialFilter }: { initialFilter: ReviewFilter }): JSX.Element {
  const { principal } = useAuth();
  const me = principal?.employeeId ?? null;
  const workHref = useWorkHref();
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
  const q = useQuery(reviewQueueQuery);

  const rows = useMemo(
    () => (q.data?.items ?? []).filter((i) => filter === 'all' || i.type === filter),
    [q.data, filter],
  );
  const counts = useMemo(() => {
    const c: Record<ReviewFilter, number> = {
      all: 0,
      filing_review: 0,
      review_point: 0,
      sign_off: 0,
    };
    for (const i of q.data?.items ?? []) {
      c.all += 1;
      c[i.type] += 1;
    }
    return c;
  }, [q.data]);

  const columns = useMemo<ColumnDef<WorkReviewItem, unknown>[]>(
    () => [
      {
        header: 'Item',
        cell: ({ row }) => (
          <span className="block max-w-[28rem]">
            <span className="block truncate">{row.original.title}</span>
            <span className="block truncate text-xs font-normal text-ink-faint">
              {reviewItemContext(row.original)}
            </span>
          </span>
        ),
      },
      {
        header: 'Type',
        cell: ({ row }) => {
          const b = TYPE_BADGE[row.original.type];
          return (
            <span className="inline-flex items-center gap-1">
              <Badge tone={b.tone}>{b.label}</Badge>
              {row.original.type === 'review_point' && row.original.isKeyMatter && (
                <Badge tone="danger">Key matter</Badge>
              )}
            </span>
          );
        },
      },
      {
        header: 'Engagement',
        cell: ({ row }) => <span className="text-ink-muted">{row.original.engagementCode}</span>,
      },
      {
        header: 'Waiting',
        cell: ({ row }) => (
          <span className={row.original.daysWaiting >= 3 ? 'font-medium text-warning-700' : ''}>
            {daysWaitingLabel(row.original.daysWaiting)}
          </span>
        ),
      },
      {
        header: 'Due',
        cell: ({ row }) => {
          const i = row.original;
          if (i.type !== 'filing_review' || !i.internalDate)
            return <span className="text-ink-faint">—</span>;
          return (
            <span>
              {formatDate(i.internalDate)}
              {i.statutoryDate && (
                <span className="ml-1 text-xs text-ink-faint">
                  (statutory {formatDate(i.statutoryDate)})
                </span>
              )}
            </span>
          );
        },
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) =>
          row.original.type === 'filing_review' ? (
            <TaskActions task={reviewTask(row.original, me)} ctx={{ me, isLead: false }} />
          ) : null,
      },
    ],
    [me],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              filter === key
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
            )}
          >
            {label}
            {q.data ? ` (${counts[key]})` : ''}
          </button>
        ))}
      </div>
      <Card className="p-0">
        {q.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {q.isError && <div className="p-4 text-sm text-danger-600">Could not load the queue.</div>}
        {q.data && (
          <DataTable
            columns={columns}
            data={rows}
            empty={
              filter === 'all' ? 'Nothing is waiting for your review.' : 'Nothing of this kind.'
            }
            rowHref={workHref}
          />
        )}
      </Card>
    </div>
  );
}
