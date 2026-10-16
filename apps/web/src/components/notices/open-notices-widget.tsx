'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAG, noticeTypeLabel } from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { fetchNotices, noticesKey } from '@/lib/notices-api';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { money, NoticeClockBadge, noticeHref } from './notice-bits';

/** GET /notices for one engagement's open notices (pure path). */
export function openNoticesPath(engagementId: string): string {
  return `/notices?engagementId=${encodeURIComponent(engagementId)}&status=open&limit=20`;
}

/**
 * PS-102 — the engagement Overview's "Open notices": the clock on each notice
 * worked under this engagement. Hidden with ff_notices off, or when there are none.
 */
export function OpenNoticesWidget({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.notices);
  const path = openNoticesPath(engagementId);
  const q = useQuery({
    queryKey: [...noticesKey, 'list', path],
    queryFn: () => fetchNotices(path),
    enabled: on,
  });
  const items = q.data?.items ?? [];
  if (!on || items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>
          Open notices ({items.length}
          {q.data?.nextCursor ? '+' : ''})
        </CardTitle>
        <Link
          href="/notices"
          className="text-xs font-semibold text-primary-600 hover:text-primary-700"
        >
          All notices
        </Link>
      </CardHeader>
      <CardBody>
        <ul className="divide-y divide-line text-sm">
          {items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Link href={noticeHref(n)} className="font-medium text-primary-700 hover:underline">
                {noticeTypeLabel(n.noticeType)}
              </Link>
              <span className="font-mono text-xs text-ink-muted">{n.referenceNo}</span>
              {n.amountDemanded && (
                <span className="text-xs tabular-nums text-ink-muted">
                  {money(n.amountDemanded)}
                </span>
              )}
              <span className="text-xs text-ink-faint">{n.ownerName}</span>
              <span className="ml-auto">
                <NoticeClockBadge clock={n.clock} />
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
