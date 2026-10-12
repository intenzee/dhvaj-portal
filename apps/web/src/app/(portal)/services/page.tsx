'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FEATURE_FLAG, STREAMS, STREAM_LABEL, type Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useFeatureFlags } from '@/lib/feature-flags';
import type { ServiceRow } from '@/lib/types';
import { PageHeader, Spinner, Badge, Card } from '@/components/ui';
import { DataTable } from '@/components/data-table';

const columns: ColumnDef<ServiceRow, unknown>[] = [
  {
    header: 'Code',
    cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.code}</span>,
  },
  { header: 'Service', accessorKey: 'name' },
  { header: 'Service line', accessorKey: 'serviceLineName' },
  {
    header: 'Required review',
    cell: ({ row }) => humanize(row.original.requiredReviewModelSlug),
  },
  {
    header: 'Status',
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge tone="success">Active</Badge>
      ) : (
        <Badge tone="neutral">Inactive</Badge>
      ),
  },
];

export default function ServicesPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const { isOn } = useFeatureFlags();
  const q = useQuery({
    queryKey: ['services', 'catalogue', search],
    queryFn: () =>
      apiFetch<Paginated<ServiceRow>>(
        `/services?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const byStream = isOn(FEATURE_FLAG.engagementKinds);

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle={
          byStream
            ? 'The firm’s catalogue, by stream: a Compliance engagement carries only the six streams; Statutory Audit and other assignments follow.'
            : "The firm's service catalogue — each service carries its workflow and review requirement."
        }
        actions={
          <Link
            href="/services/components"
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised"
          >
            Manage components →
          </Link>
        }
      />
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services…"
          className="w-full max-w-sm rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>
      {q.isLoading && <Spinner />}
      {q.data &&
        (byStream ? (
          <ServicesByStream services={q.data.items} />
        ) : (
          <DataTable columns={columns} data={q.data.items} empty="No services found." />
        ))}
    </div>
  );
}

/**
 * Spec Change 2: the catalogue groups by stream first. Each stream shows its
 * live STREAM_* service and, below it, the old services folded into it (kept
 * for history, no longer offered). Statutory Audit and the assignment services
 * follow.
 */
function ServicesByStream({ services }: { services: ServiceRow[] }): JSX.Element {
  const [showFolded, setShowFolded] = useState(false);
  const streamGroups = STREAMS.map((stream) => ({
    stream,
    rows: services.filter((s) => s.stream === stream),
  })).filter((g) => g.rows.length > 0);
  const audit = services.filter((s) => s.engagementKind === 'statutory_audit');
  const assignments = services.filter(
    (s) => !s.stream && s.engagementKind !== 'statutory_audit' && (showFolded || s.isActive),
  );
  if (services.length === 0) return <p className="text-sm text-ink-faint">No services found.</p>;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary-600"
          checked={showFolded}
          onChange={(e) => setShowFolded(e.target.checked)}
        />
        Show folded and inactive services
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        {streamGroups.map(({ stream, rows }) => {
          const live = rows.filter((r) => r.isActive);
          const folded = rows.filter((r) => !r.isActive);
          return (
            <Card key={stream} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-ink">{STREAM_LABEL[stream]}</h2>
                <Badge tone="info">Compliance stream</Badge>
              </div>
              <ul className="space-y-1 text-sm">
                {live.map((s) => (
                  <ServiceLine key={s.id} service={s} />
                ))}
              </ul>
              {folded.length > 0 && (
                <p className="mt-2 text-xs text-ink-faint">
                  {showFolded
                    ? 'Folded in (history only):'
                    : `${folded.length} older services folded in`}
                </p>
              )}
              {showFolded && folded.length > 0 && (
                <ul className="mt-1 space-y-1 text-sm opacity-70">
                  {folded.map((s) => (
                    <ServiceLine key={s.id} service={s} />
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {audit.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-ink">Statutory Audit</h2>
          <ul className="space-y-1 text-sm">
            {audit.map((s) => (
              <ServiceLine key={s.id} service={s} />
            ))}
          </ul>
        </Card>
      )}

      {assignments.length > 0 && (
        <Card className="p-0">
          <h2 className="px-4 pt-4 font-semibold text-ink">Other assignments</h2>
          <DataTable columns={columns} data={assignments} empty="No services found." />
        </Card>
      )}
    </div>
  );
}

function ServiceLine({ service }: { service: ServiceRow }): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>
        <span className="font-medium text-ink">{service.name}</span>
        <span className="ml-2 font-mono text-xs text-ink-faint">{service.code}</span>
      </span>
      <span className="text-xs text-ink-muted">{humanize(service.requiredReviewModelSlug)}</span>
    </li>
  );
}
