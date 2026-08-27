'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EngagementRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Badge } from '@/components/ui';
import { DataTable } from '@/components/data-table';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'review' | 'signoff';

/** The review state an engagement is in, derived from its read model. */
function reviewState(e: EngagementRow): { label: string; tone: string } {
  if (e.isSignedOff) return { label: 'Signed off', tone: 'success' };
  if (e.openReviewPointCount > 0) return { label: 'Review points open', tone: 'warn' };
  if (e.effectiveReviewModel.requiresEpSignoff) return { label: 'Awaiting EP sign-off', tone: 'info' };
  return { label: 'Manager completion', tone: 'neutral' };
}

const columns: ColumnDef<EngagementRow, unknown>[] = [
  { header: 'Code', cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.engagementCode}</span> },
  { header: 'Client', accessorKey: 'entityName' },
  { header: 'Service', accessorKey: 'serviceName' },
  { header: 'Review model', cell: ({ row }) => row.original.effectiveReviewModel.name },
  {
    header: 'Review state',
    cell: ({ row }) => {
      const s = reviewState(row.original);
      return <Badge tone={s.tone}>{s.label}</Badge>;
    },
  },
];

function ReviewsInner(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const initial: Filter = params.get('filter') === 'signoff' ? 'signoff' : params.get('filter') === 'high-risk' ? 'review' : 'all';
  const [filter, setFilter] = useState<Filter>(initial);

  const q = useQuery({
    queryKey: ['reviews', 'active-engagements'],
    queryFn: () => apiFetch<Paginated<EngagementRow>>('/engagements?status=active&limit=100'),
  });

  const rows = useMemo(() => {
    const items = q.data?.items ?? [];
    return items.filter((e) => {
      if (e.isSignedOff) return false; // the queue is work still needing review/sign-off
      if (filter === 'review') return e.openReviewPointCount > 0;
      if (filter === 'signoff')
        return e.effectiveReviewModel.requiresEpSignoff && e.openReviewPointCount === 0;
      return true;
    });
  }, [q.data, filter]);

  return (
    <div>
      <PageHeader
        title="Reviews & Sign-offs"
        subtitle="Active engagements still needing review or sign-off (assignment-scoped)."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All needing attention'],
            ['review', 'Review points open'],
            ['signoff', 'Sign-off pending'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              filter === key
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        {q.isLoading && <div className="p-4"><Spinner /></div>}
        {q.data && (
          <DataTable
            columns={columns}
            data={rows}
            empty="Nothing in the review queue for this filter."
            onRowClick={(row) => router.push(`/engagements/${row.id}`)}
          />
        )}
      </Card>
    </div>
  );
}

export default function ReviewsPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <ReviewsInner />
    </Suspense>
  );
}
