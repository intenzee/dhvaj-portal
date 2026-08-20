'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { EntityRow } from '@/lib/types';
import { PageHeader, Spinner, Card } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';

const columns: ColumnDef<EntityRow, unknown>[] = [
  { header: 'Code', cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.entityCode}</span> },
  { header: 'Legal name', accessorKey: 'legalName' },
  { header: 'Type', accessorKey: 'typeName' },
  { header: 'PAN', cell: ({ row }) => row.original.pan ?? <span className="text-ink-faint">—</span> },
  { header: 'Registrations', cell: ({ row }) => row.original.registrationCount },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];

export default function EntitiesPage(): JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const q = useQuery({
    queryKey: ['entities', search],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(
        `/entities?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <div>
      <PageHeader title="Entities" subtitle="Client entities you can access. Open one for Client 360." />

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or PAN…"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <Card className="p-0">
        {q.isLoading && <div className="p-4"><Spinner /></div>}
        {q.data && (
          <DataTable
            columns={columns}
            data={q.data.items}
            empty="No entities match your search."
            onRowClick={(row) => router.push(`/entities/${row.id}`)}
          />
        )}
      </Card>
    </div>
  );
}
