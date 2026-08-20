'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EngagementRow } from '@/lib/types';
import { Panel, Spinner, EmptyState, Badge } from '@/components/ui';

function state(e: EngagementRow): { label: string; tone: string } {
  if (e.openReviewPointCount > 0)
    return { label: `${e.openReviewPointCount} review pt${e.openReviewPointCount === 1 ? '' : 's'}`, tone: 'warn' };
  if (e.effectiveReviewModel.requiresEpSignoff) return { label: 'EP sign-off', tone: 'info' };
  return { label: 'Manager review', tone: 'neutral' };
}

export function ReviewQueuePanel(): JSX.Element {
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
              className="flex cursor-pointer items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0 hover:bg-slate-50"
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
