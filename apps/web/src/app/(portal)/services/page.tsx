'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { ServiceRow } from '@/lib/types';
import { PageHeader, Spinner, Badge } from '@/components/ui';
import { DataTable } from '@/components/data-table';

const columns: ColumnDef<ServiceRow, unknown>[] = [
  { header: 'Code', cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.code}</span> },
  { header: 'Service', accessorKey: 'name' },
  { header: 'Service line', accessorKey: 'serviceLineName' },
  {
    header: 'Required review',
    cell: ({ row }) => humanize(row.original.requiredReviewModelSlug),
  },
  {
    header: 'Status',
    cell: ({ row }) =>
      row.original.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>,
  },
];

export default function ServicesPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['services', 'catalogue', search],
    queryFn: () =>
      apiFetch<Paginated<ServiceRow>>(
        `/services?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="The firm's service catalogue — each service carries its workflow and review requirement."
      />
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services…"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>
      {q.isLoading && <Spinner />}
      {q.data && <DataTable columns={columns} data={q.data.items} empty="No services found." />}
    </div>
  );
}
