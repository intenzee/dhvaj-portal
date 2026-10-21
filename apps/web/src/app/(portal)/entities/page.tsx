'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PERMISSION, type MissingFilter, type Paginated } from '@hsdg/contracts';
import { FileCheck2, Plus, Upload } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import type { EntityRow } from '@/lib/types';
import { PageHeader, Spinner, Card, Button } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { SectionChips, useUrlSections } from '@/components/section-filter';
import { entityListPath } from '@/lib/list-paths';
import { MISSING_FILTER_OPTIONS, MissingDataMarker } from '@/components/entities/missing-data';

const PAGE_SIZE = 25;

const columns: ColumnDef<EntityRow, unknown>[] = [
  {
    header: 'Code',
    cell: ({ row }) => (
      <span className="font-medium text-primary-700">{row.original.entityCode}</span>
    ),
  },
  { header: 'Legal name', accessorKey: 'legalName' },
  { header: 'Type', accessorKey: 'typeName' },
  {
    header: 'PAN',
    cell: ({ row }) => row.original.pan ?? <span className="text-ink-faint">—</span>,
  },
  { header: 'Registrations', cell: ({ row }) => row.original.registrationCount },
  {
    header: 'Missing data',
    cell: ({ row }) => <MissingDataMarker items={row.original.missingInfo} />,
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];

function EntitiesInner(): JSX.Element {
  const router = useRouter();
  const { principal } = useAuth();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [missing, setMissing] = useState<MissingFilter | ''>('');
  const [sections, setSectionsUrl] = useUrlSections();

  const onSearch = (v: string): void => {
    setSearch(v);
    setOffset(0);
  };
  const setSections = (next: typeof sections): void => {
    setSectionsUrl(next);
    setOffset(0);
  };

  const q = useQuery({
    queryKey: ['entities', search, sections, missing, offset],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(
        entityListPath({ limit: PAGE_SIZE, offset, search, sections, missing: missing || null }),
      ),
  });

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Companies, firms and individuals we work for. Click a client to see everything we do for them."
        actions={
          <div className="flex gap-2">
            <Link href="/entities/returns">
              <Button variant="secondary">
                <FileCheck2 className="h-4 w-4" /> GST returns
              </Button>
            </Link>
            {can(principal, PERMISSION.entityManage) && (
              <>
                {can(principal, PERMISSION.credentialManage) && (
                  <Link href="/entities/import">
                    <Button variant="secondary">
                      <Upload className="h-4 w-4" /> Import client logins
                    </Button>
                  </Link>
                )}
                <Link href="/entities/new">
                  <Button>
                    <Plus className="h-4 w-4" /> New client
                  </Button>
                </Link>
              </>
            )}
          </div>
        }
      />

      <SectionChips value={sections} onChange={setSections} className="mb-3" />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or PAN…"
          className="w-full max-w-sm rounded-md border border-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          aria-label="Missing data"
          value={missing}
          onChange={(e) => {
            setMissing(e.target.value as MissingFilter | '');
            setOffset(0);
          }}
          className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {MISSING_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
            columns={columns}
            data={q.data.items}
            empty={
              missing
                ? 'No clients match this missing-data filter.'
                : sections.length
                  ? 'No clients in this section match.'
                  : 'No entities match your search.'
            }
            onRowClick={(row) => router.push(`/entities/${row.id}`)}
          />
        )}
      </Card>
      {q.data && (
        <Pagination
          total={q.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="entities"
        />
      )}
    </div>
  );
}

export default function EntitiesPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <EntitiesInner />
    </Suspense>
  );
}
