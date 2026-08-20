'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { EntityDetail, EngagementRow } from '@/lib/types';
import {
  PageHeader,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  EmptyState,
} from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';

/** Client 360 — the entity, its registrations & contacts, and its engagements. */
export default function EntityDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const entity = useQuery({
    queryKey: ['entity', id],
    queryFn: () => apiFetch<EntityDetail>(`/entities/${id}`),
  });
  const engagements = useQuery({
    queryKey: ['entity', id, 'engagements'],
    queryFn: () => apiFetch<Paginated<EngagementRow>>(`/engagements?entityId=${id}&limit=100`),
  });

  if (entity.isLoading) return <Spinner label="Loading client…" />;
  if (entity.isError || !entity.data)
    return <EmptyState>Client not found, or you don&rsquo;t have access to it.</EmptyState>;

  const e = entity.data;

  return (
    <div>
      <PageHeader title={e.legalName} subtitle={`${e.entityCode} · ${e.typeName}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Registrations</CardTitle>
            <StatusBadge status={e.status} />
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {e.pan && (
              <div className="flex justify-between">
                <span className="text-ink-faint">PAN</span>
                <span className="font-medium">{e.pan}</span>
              </div>
            )}
            {e.registrations.length === 0 && <p className="text-ink-faint">No registrations.</p>}
            {e.registrations.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <span className="text-ink-muted">{humanize(r.registrationType)}</span>
                <span className="font-medium">{r.registrationNumber}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contacts &amp; signatories</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {e.contacts.length === 0 && <p className="text-ink-faint">No contacts.</p>}
            {e.contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-ink">{c.fullName}</span>
                  {c.designation && <span className="ml-2 text-ink-faint">{c.designation}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {c.email && <span className="text-ink-muted">{c.email}</span>}
                  {c.isPrimary && <Badge tone="info">Primary</Badge>}
                  {c.isSignatory && <Badge tone="neutral">Signatory</Badge>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">Engagements</h2>
        <Card className="p-0">
          {engagements.data && (
            <DataTable
              columns={engagementCols}
              data={engagements.data.items}
              empty="No engagements for this client in your scope."
              onRowClick={(row) => router.push(`/engagements/${row.id}`)}
            />
          )}
        </Card>
      </section>

      <p className="mt-4 text-xs text-ink-faint">
        <Link href="/entities" className="text-primary-600 hover:underline">
          ← Back to entities
        </Link>
      </p>
    </div>
  );
}

const engagementCols: ColumnDef<EngagementRow, unknown>[] = [
  { header: 'Code', cell: ({ row }) => <span className="font-medium text-primary-700">{row.original.engagementCode}</span> },
  { header: 'Service', accessorKey: 'serviceName' },
  {
    header: 'Period',
    cell: ({ row }) => `${row.original.financialYear} ${row.original.periodLabel}`,
  },
  { header: 'EP', cell: ({ row }) => row.original.engagementPartnerName ?? '—' },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];
