'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { deadlineLabel } from '@/lib/format';
import type { MyClientDependency } from '@/lib/types';
import { PageHeader, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { ClientDependencyActions } from '@/components/actions/client-dependency-actions';

const columns: ColumnDef<MyClientDependency, unknown>[] = [
  { header: 'Requested', accessorKey: 'requestedInfo' },
  {
    header: 'Engagement',
    cell: ({ row }) => (
      <span className="text-ink-muted">
        {row.original.engagementCode} · {row.original.entityName}
      </span>
    ),
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  {
    header: 'Escalation',
    cell: ({ row }) =>
      row.original.escalationDate ? (
        <span className={row.original.isOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}>
          {deadlineLabel(row.original.escalationDate)}
        </span>
      ) : (
        <span className="text-ink-faint">—</span>
      ),
  },
  { header: '', cell: ({ row }) => <ClientDependencyActions dep={row.original} /> },
];

export default function ClientDependenciesPage(): JSX.Element {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['client-dependencies', 'mine'],
    queryFn: () => apiFetch<Paginated<MyClientDependency>>('/work/client-dependencies?limit=100'),
  });

  return (
    <div>
      <PageHeader
        title="Client Dependencies"
        subtitle="Information you're waiting on from clients, across every engagement."
      />
      {q.isLoading && <Spinner />}
      {q.data && (
        <DataTable
          columns={columns}
          data={q.data.items}
          empty="You're not waiting on any client information."
          onRowClick={(row) => router.push(`/engagements/${row.engagementId}`)}
        />
      )}
    </div>
  );
}
