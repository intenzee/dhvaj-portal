'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ENGAGEMENT_KINDS,
  ENGAGEMENT_STATUS,
  ENGAGEMENT_STATUSES,
  FEATURE_FLAG,
  PERMISSION,
  type EngagementKind,
  type Paginated,
  type EngagementStatus,
} from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { KIND_LABEL } from '@/lib/engagement-kinds';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { EngagementRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Badge } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { rememberedHref } from '@/lib/last-place';
import { Pagination } from '@/components/pagination';
import { SectionChips, useUrlSections } from '@/components/section-filter';
import { engagementListPath } from '@/lib/list-paths';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

/** Statuses shown as one-click chips; the rest sit under "More" to keep the bar short. */
const COMMON_STATUSES: EngagementStatus[] = [
  ENGAGEMENT_STATUS.active,
  ENGAGEMENT_STATUS.pendingAcceptance,
  ENGAGEMENT_STATUS.accepted,
  ENGAGEMENT_STATUS.onHold,
  ENGAGEMENT_STATUS.completed,
];
const OTHER_STATUSES = ENGAGEMENT_STATUSES.filter((s) => !COMMON_STATUSES.includes(s));

const codeColumn: ColumnDef<EngagementRow, unknown> = {
  header: 'Code',
  cell: ({ row }) => (
    <span className="font-medium text-primary-700">{row.original.engagementCode}</span>
  ),
};
const kindColumn: ColumnDef<EngagementRow, unknown> = {
  header: 'Kind',
  cell: ({ row }) => (
    <Badge tone={row.original.kind === 'assignment' ? 'neutral' : 'info'}>
      {KIND_LABEL[row.original.kind]}
    </Badge>
  ),
};

const columns: ColumnDef<EngagementRow, unknown>[] = [
  codeColumn,
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
  {
    header: 'Partner',
    cell: ({ row }) =>
      row.original.engagementPartnerName ?? <span className="text-ink-faint">—</span>,
  },
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
  const { principal } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<EngagementStatus | ''>(
    (params.get('status') as EngagementStatus | null) ?? '',
  );
  const { isOn } = useFeatureFlags();
  const kindsOn = isOn(FEATURE_FLAG.engagementKinds);
  const initialKind = params.get('kind');
  const [kind, setKind] = useState<EngagementKind | ''>(
    ENGAGEMENT_KINDS.includes(initialKind as EngagementKind) ? (initialKind as EngagementKind) : '',
  );
  const [offset, setOffset] = useState(0);
  const [sections, setSectionsUrl] = useUrlSections();
  // The home panel's View all opens this page on my engagements only.
  const mine = params.get('mine') === 'true';

  // Reset to the first page whenever the filter changes.
  const setSections = (next: typeof sections): void => {
    setSectionsUrl(next);
    setOffset(0);
  };
  const setStatusFiltered = (s: EngagementStatus | ''): void => {
    setStatus(s);
    setOffset(0);
  };
  const setKindFiltered = (k: EngagementKind | ''): void => {
    setKind(k);
    setOffset(0);
    const next = new URLSearchParams(params.toString());
    if (k) next.set('kind', k);
    else next.delete('kind');
    router.replace(`/engagements${next.toString() ? `?${next.toString()}` : ''}`, {
      scroll: false,
    });
  };
  const activeKind = kindsOn ? kind : '';

  const q = useQuery({
    queryKey: ['engagements', status, activeKind, mine, sections, offset],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(
        engagementListPath({ limit: PAGE_SIZE, offset, status, kind: activeKind, mine, sections }),
      ),
  });

  return (
    <div>
      <PageHeader
        title="Engagements"
        subtitle="Each engagement is one job for one client. You see the ones you are assigned to — click a row to open it."
        actions={
          can(principal, PERMISSION.engagementManage) && (
            <Link
              href="/engagements/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" /> New engagement
            </Link>
          )
        }
      />

      {kindsOn && (
        <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="Engagement kind">
          <FilterChip label="All kinds" active={kind === ''} onClick={() => setKindFiltered('')} />
          {ENGAGEMENT_KINDS.map((k) => (
            <FilterChip
              key={k}
              label={KIND_LABEL[k]}
              active={kind === k}
              onClick={() => setKindFiltered(k)}
            />
          ))}
        </div>
      )}

      <SectionChips value={sections} onChange={setSections} className="mb-2" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {mine && (
          <FilterChip
            label="Mine only ✕"
            active
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.delete('mine');
              setOffset(0);
              router.replace(`/engagements${next.toString() ? `?${next.toString()}` : ''}`, {
                scroll: false,
              });
            }}
          />
        )}
        <FilterChip label="All" active={status === ''} onClick={() => setStatusFiltered('')} />
        {COMMON_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={humanize(s)}
            active={status === s}
            onClick={() => setStatusFiltered(s)}
          />
        ))}
        <select
          aria-label="More statuses"
          value={OTHER_STATUSES.includes(status as EngagementStatus) ? status : ''}
          onChange={(e) => setStatusFiltered(e.target.value as EngagementStatus | '')}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium',
            OTHER_STATUSES.includes(status as EngagementStatus)
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-line-strong bg-surface text-ink-muted',
          )}
        >
          <option value="">More…</option>
          {OTHER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>

      <Card className="p-0">
        {q.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {q.data && (
          <DataTable
            columns={kindsOn ? [codeColumn, kindColumn, ...columns.slice(1)] : columns}
            data={q.data.items}
            empty="No engagements match this view."
            // WF-203: reopen the tab and period last worked on here, when remembered.
            onRowClick={(row) => router.push(rememberedHref(row.id) ?? `/engagements/${row.id}`)}
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
          : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
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
