'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { PERMISSION, type MissingFilter, type Paginated } from '@hsdg/contracts';
import { FileSpreadsheet, Plus, Upload } from 'lucide-react';
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
import { ExportClientMasterButton } from '@/components/entities/client-master';
import { PossibleDuplicatesList } from '@/components/entities/duplicate-clients';
import { useDuplicates } from '@/components/entities/merge-clients-modal';
import { useClientListTeams } from '@/components/teams/client-list-teams';
import { OfficesToCombineList, useBranchCandidates } from '@/components/entities/offices-review';
import { DataCheckView } from '@/components/entities/data-check';

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
  {
    header: 'Registrations',
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        {row.original.registrationCount}
        {(row.original.branchCount ?? 0) > 1 && (
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-ink-muted">
            {row.original.branchCount} offices
          </span>
        )}
      </span>
    ),
  },
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
  const [view, setView] = useState<'all' | 'duplicates' | 'offices' | 'checks'>('all');
  const canManage = can(principal, PERMISSION.entityManage);
  const dupes = useDuplicates();
  const dupeCount = dupes.data?.length ?? 0;
  const offices = useBranchCandidates();
  const officeCount = offices.data?.length ?? 0;

  const onSearch = (v: string): void => {
    setSearch(v);
    setOffset(0);
  };
  const setSections = (next: typeof sections): void => {
    setSectionsUrl(next);
    setOffset(0);
  };

  const teams = useClientListTeams(() => setOffset(0));
  const q = useQuery({
    queryKey: ['entities', search, sections, missing, offset, teams.team],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(
        entityListPath({
          limit: PAGE_SIZE,
          offset,
          search,
          sections,
          missing: missing || null,
          team: teams.team,
        }),
      ),
  });

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Companies, firms and individuals we work for. Click a client to see everything we do for them."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(principal, PERMISSION.entityManage) && (
              <>
                <ExportClientMasterButton />
                {can(principal, PERMISSION.credentialManage) && (
                  <Link href="/entities/master">
                    <Button variant="secondary">
                      <FileSpreadsheet className="h-4 w-4" /> Import client master
                    </Button>
                  </Link>
                )}
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

      {(canManage || dupeCount > 0 || officeCount > 0 || view !== 'all') && (
        <div
          role="tablist"
          aria-label="Clients view"
          className="mb-3 flex gap-1 border-b border-line"
        >
          {(
            [
              ['all', 'All clients'],
              ['duplicates', `Possible duplicates (${dupeCount})`],
              ['offices', `Offices to combine (${officeCount})`],
              ...(canManage ? ([['checks', 'Data check']] as const) : []),
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                view === v
                  ? 'border-primary-600 font-medium text-primary-700'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'duplicates' ? (
        <PossibleDuplicatesList />
      ) : view === 'offices' ? (
        <OfficesToCombineList />
      ) : view === 'checks' ? (
        <DataCheckView onOpenOffices={() => setView('offices')} />
      ) : (
        <>
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
            {teams.filter}
          </div>
          {teams.bulkBar}

          <Card className="p-0">
            {q.isLoading && (
              <div className="p-4">
                <Spinner />
              </div>
            )}
            {q.data && (
              <DataTable
                columns={teams.withTeamColumns(columns, q.data.items)}
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
        </>
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
