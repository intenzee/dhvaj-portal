'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { ENGAGEMENT_STATUSES, type Paginated, type EngagementStatus } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { EngagementRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Badge } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const columns: ColumnDef<EngagementRow, unknown>[] = [
  {
    header: 'Code',
    cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.engagementCode}</span>,
  },
  { header: 'Client', accessorKey: 'entityName' },
  {
    header: 'Service',
    cell: ({ row }) => (
      <span>
        {row.original.serviceName}
        <span className="ml-1 text-ink-faint">
          · {row.original.financialYear} {row.original.periodLabel}
        </span>
      </span>
    ),
  },
  { header: 'EP', cell: ({ row }) => row.original.engagementPartnerName ?? <span className="text-ink-faint">—</span> },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  {
    header: 'Signals',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.isWaitingForClient && <Badge tone="warn">Waiting for client</Badge>}
        {row.original.internallyOverdueTaskCount > 0 && (
          <Badge tone="danger">{row.original.internallyOverdueTaskCount} overdue</Badge>
        )}
        {row.original.openReviewPointCount > 0 && (
          <Badge tone="info">{row.original.openReviewPointCount} review pts</Badge>
        )}
        {row.original.isSignedOff && <Badge tone="success">Signed off</Badge>}
      </div>
    ),
  },
];

function EngagementsInner(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<EngagementStatus | ''>(
    (params.get('status') as EngagementStatus | null) ?? '',
  );
  const [offset, setOffset] = useState(0);

  // Reset to the first page whenever the filter changes.
  const setStatusFiltered = (s: EngagementStatus | ''): void => {
    setStatus(s);
    setOffset(0);
  };

  const q = useQuery({
    queryKey: ['engagements', status, offset],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(
        `/engagements?limit=${PAGE_SIZE}&offset=${offset}${status ? `&status=${status}` : ''}`,
      ),
  });

  return (
    <div>
      <PageHeader
        title="Engagements"
        subtitle="Engagements you can access (assignment-scoped)."
        actions={
          <Link
            href="/engagements/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" /> New engagement
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip label="All" active={status === ''} onClick={() => setStatusFiltered('')} />
        {ENGAGEMENT_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={humanize(s)}
            active={status === s}
            onClick={() => setStatusFiltered(s)}
          />
        ))}
      </div>

      <Card className="p-0">
        {q.isLoading && <div className="p-4"><Spinner /></div>}
        {q.data && (
          <DataTable
            columns={columns}
            data={q.data.items}
            empty="No engagements match this view."
            onRowClick={(row) => router.push(`/engagements/${row.id}`)}
          />
        )}
      </Card>
      {q.data && (
        <Pagination
          total={q.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="engagements"
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-slate-200 bg-white text-ink-muted hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  );
}

export default function EngagementsPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <EngagementsInner />
    </Suspense>
  );
}
