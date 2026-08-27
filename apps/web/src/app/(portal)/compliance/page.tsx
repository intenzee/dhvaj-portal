'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { Settings2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, deadlineLabel } from '@/lib/format';
import type { ComplianceRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Badge, Button } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'overdue' | 'due-soon';

const columns: ColumnDef<ComplianceRow, unknown>[] = [
  {
    header: 'Engagement',
    cell: ({ row }) => (
      <span>
        <span className="font-medium text-primary-700">{row.original.engagementCode}</span>
        <span className="ml-1 text-ink-faint">· {row.original.entityName}</span>
      </span>
    ),
  },
  { header: 'Obligation', accessorKey: 'complianceRuleName' },
  {
    header: 'Statutory deadline',
    cell: ({ row }) => (
      <span className={row.original.isStatutoryOverdue ? 'font-medium text-rose-600' : ''}>
        {formatDate(row.original.effectiveStatutoryDeadline)}
        <span className="ml-1 text-xs text-ink-faint">
          ({deadlineLabel(row.original.effectiveStatutoryDeadline)})
        </span>
      </span>
    ),
  },
  {
    header: 'Internal SLA',
    cell: ({ row }) => (
      <span className={row.original.isInternallyOverdue ? 'font-medium text-amber-700' : ''}>
        {formatDate(row.original.effectiveInternalSlaDate)}
      </span>
    ),
  },
  {
    header: 'Flags',
    cell: ({ row }) => (
      <div className="flex gap-1">
        {row.original.isStatutoryOverdue && <Badge tone="danger">Statutory overdue</Badge>}
        {row.original.isInternallyOverdue && <Badge tone="warn">SLA overdue</Badge>}
      </div>
    ),
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];

function inNextDays(iso: string, days: number): boolean {
  const d = new Date(iso).getTime();
  const now = Date.now();
  return d >= now - 86_400_000 && d <= now + days * 86_400_000;
}

function ComplianceInner(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { principal } = useAuth();
  const initial: Filter =
    params.get('filter') === 'overdue' ? 'overdue' : params.get('filter') === 'due-soon' ? 'due-soon' : 'all';
  const [filter, setFilter] = useState<Filter>(initial);

  const q = useQuery({
    queryKey: ['compliance', 'calendar'],
    queryFn: () => apiFetch<Paginated<ComplianceRow>>('/compliance?status=open&limit=100'),
  });

  const rows = (q.data?.items ?? []).filter((r) => {
    if (filter === 'overdue') return r.isStatutoryOverdue;
    if (filter === 'due-soon') return !r.isStatutoryOverdue && inNextDays(r.effectiveStatutoryDeadline, 7);
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Compliance Calendar"
        subtitle="Open obligations across your engagements, by statutory deadline. Two clocks: statutory vs internal SLA."
        actions={
          can(principal, PERMISSION.complianceManage) ? (
            <Link href="/compliance/rules">
              <Button variant="secondary">
                <Settings2 className="h-4 w-4" /> Configure rules
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All open'],
            ['overdue', 'Statutory overdue'],
            ['due-soon', 'Due soon (7d)'],
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
            empty="No obligations match this filter."
            onRowClick={(row) => router.push(`/engagements/${row.engagementId}`)}
          />
        )}
      </Card>
    </div>
  );
}

export default function CompliancePage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <ComplianceInner />
    </Suspense>
  );
}
