'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  workItemHref,
  type Paginated,
  type WorkReviewItem,
  type WorkReviewQueue,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import type { EngagementRow } from '@/lib/types';
import { Panel, Spinner, EmptyState, Badge } from '@/components/ui';

function state(e: EngagementRow): { label: string; tone: string } {
  if (e.openReviewPointCount > 0)
    return { label: `${e.openReviewPointCount} review pt${e.openReviewPointCount === 1 ? '' : 's'}`, tone: 'warn' };
  if (e.effectiveReviewModel.requiresEpSignoff) return { label: 'EP sign-off', tone: 'info' };
  return { label: 'Manager review', tone: 'neutral' };
}

/** The review queue the Home panel and My Work's "To review" tab share (WF-105). */
export const reviewQueueQuery = {
  queryKey: ['work', 'reviews'] as const,
  queryFn: () => apiFetch<WorkReviewQueue>('/work/reviews'),
};

const TYPE_LABEL: Record<WorkReviewItem['type'], string> = {
  filing_review: 'Review',
  review_point: 'Review point',
  sign_off: 'Sign-off',
};

/** One line of context under a queue item's title. Pure — tested. */
export function reviewItemContext(item: WorkReviewItem): string {
  const who =
    item.type === 'filing_review'
      ? item.preparerName
      : item.type === 'review_point'
        ? item.raisedByName
        : item.clearedByName;
  const filing = item.type === 'filing_review' && item.filing ? `${item.filing.periodLabel} · ` : '';
  return `${filing}${item.entityName}${who ? ` · from ${who}` : ''}`;
}

/** `0` → 'today', `1` → '1 day'. Pure — tested. */
export function daysWaitingLabel(days: number): string {
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function ReviewQueuePanel(): JSX.Element {
  const { isOn, isLoading } = useFeatureFlags();
  if (isLoading) {
    return (
      <Panel title="Review & Sign-off Queue">
        <Spinner />
      </Panel>
    );
  }
  return isOn(FEATURE_FLAG.workLinks) ? <WaitingOnMePanel /> : <LegacyReviewQueuePanel />;
}

/** ff_work_links: what is waiting for MY review, oldest first, each opening the item itself. */
function WaitingOnMePanel(): JSX.Element {
  const q = useQuery(reviewQueueQuery);
  const rows = (q.data?.items ?? []).slice(0, 5);

  return (
    <Panel
      title="Waiting for my review"
      linkHref="/my-work?tab=to-review"
      linkLabel={q.data && q.data.total > rows.length ? `All ${q.data.total}` : undefined}
      bodyClassName="p-0"
    >
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && rows.length === 0 && (
        <div className="p-5"><EmptyState>Nothing is waiting for your review.</EmptyState></div>
      )}
      <ul>
        {rows.map((item) => (
          <li key={`${item.type}:${item.id}`} className="border-b border-line last:border-0">
            <Link
              href={workItemHref(item.link)}
              className="flex items-center gap-3 px-5 py-3 hover:bg-surface-raised"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                <div className="truncate text-xs text-ink-faint">{reviewItemContext(item)}</div>
              </div>
              <div className="shrink-0 text-right">
                <Badge
                  tone={item.type === 'review_point' ? 'warn' : item.type === 'sign_off' ? 'info' : 'neutral'}
                >
                  {TYPE_LABEL[item.type]}
                </Badge>
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  waiting {daysWaitingLabel(item.daysWaiting)}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LegacyReviewQueuePanel(): JSX.Element {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['engagements', 'active', 'dashboard'],
    queryFn: () => apiFetch<Paginated<EngagementRow>>('/engagements?status=active&limit=100'),
  });
  const rows = (q.data?.items ?? []).filter((e) => !e.isSignedOff).slice(0, 5);

  return (
    <Panel title="Review & Sign-off Queue" linkHref="/reviews" bodyClassName="p-0">
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && rows.length === 0 && (
        <div className="p-5"><EmptyState>Nothing awaiting review.</EmptyState></div>
      )}
      <ul>
        {rows.map((e) => {
          const s = state(e);
          return (
            <li
              key={e.id}
              onClick={() => router.push(`/engagements/${e.id}`)}
              className="flex cursor-pointer items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-raised"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {e.entityName} — {e.serviceName}
                </div>
                <div className="truncate text-xs text-ink-faint">{e.effectiveReviewModel.name}</div>
              </div>
              <Badge tone={s.tone}>{s.label}</Badge>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
