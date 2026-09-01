'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
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
import { EntityDetailActions } from '@/components/entities/entity-actions';
import { RegulatoryProfile } from '@/components/entities/regulatory-profile';

const inr = (n: number | null): string =>
  n === null ? '—' : `₹${n.toLocaleString('en-IN')}`;

/** Client 360 — the entity's facts, progressive-completion gaps, and downstream regulatory profile. */
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
  const currentFinancials = e.financialProfiles.filter((f) => f.isCurrent);

  return (
    <div className="space-y-5">
      <PageHeader
        title={e.legalName}
        subtitle={`${e.entityCode} · ${e.typeName}${e.tradeName ? ` · ${e.tradeName}` : ''}`}
        actions={<EntityDetailActions entity={e} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={e.status} />
        {e.legalStatus && <Badge tone="neutral">{humanize(e.legalStatus)}</Badge>}
        {e.listingStatus && e.listingStatus !== 'unlisted' && (
          <Badge tone="info">{humanize(e.listingStatus)}</Badge>
        )}
        <Badge tone={e.regulatoryProfileStatus === 'needs_reassessment' ? 'danger' : 'neutral'}>
          Regulatory: {humanize(e.regulatoryProfileStatus ?? 'incomplete')}
        </Badge>
      </div>

      {/* Progressive completion — prominent, and never "Not Applicable" (§5/§27). */}
      {e.missingInfo.length > 0 && (
        <Card className="border-warning-200">
          <CardBody className="py-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning-700">
              <AlertTriangle className="h-4 w-4" /> Missing / pending information ({e.missingInfo.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {e.missingInfo.map((m) => (
                <span key={m.code} className="rounded-md bg-warning-50 px-2 py-0.5 text-xs text-warning-700">
                  {m.label}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Missing information is not the same as Not Applicable — complete it as Dhvaj obtains it.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Fact label="PAN" value={e.pan ?? 'Pending'} />
        <Fact label="Country of incorporation" value={e.countryOfIncorporation} />
        <Fact label="Date of incorporation" value={e.incorporationDate ?? '—'} />
        <Fact label="Accounting framework" value={humanize(e.currentAccountingFramework)} />
        {e.roc && <Fact label="ROC" value={e.roc} />}
        {e.authorisedCapital !== null && <Fact label="Authorised capital" value={inr(e.authorisedCapital)} />}
        {e.paidUpCapital !== null && <Fact label="Paid-up capital" value={inr(e.paidUpCapital)} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registrations</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {e.registrations.length === 0 && <p className="text-ink-faint">No registrations recorded.</p>}
            {e.registrations.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-ink-muted">{humanize(r.registrationType)}</span>{' '}
                  <span className="font-medium text-ink">{r.registrationNumber}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={r.status === 'active' ? 'success' : r.status === 'pending' ? 'warn' : 'neutral'}>
                    {humanize(r.status)}
                  </Badge>
                  {r.verified && (
                    <span title="Verified" className="text-success-600">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contacts &amp; signatories</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {e.contacts.length === 0 && <p className="text-ink-faint">No contacts recorded.</p>}
            {e.contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-ink">{c.fullName}</span>
                  {c.designation && <span className="ml-2 text-ink-faint">{c.designation}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {c.email && <span className="text-ink-muted">{c.email}</span>}
                  {c.isPrimary && <Badge tone="info">Primary</Badge>}
                  {c.isPortalUser && <Badge tone="neutral">Portal</Badge>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* Year-wise financials (§16) */}
      {currentFinancials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Financial profile</CardTitle>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="py-1 pr-4">FY</th>
                  <th className="py-1 pr-4">Turnover</th>
                  <th className="py-1 pr-4">Net worth</th>
                  <th className="py-1 pr-4">Borrowings</th>
                  <th className="py-1 pr-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {currentFinancials.map((f) => (
                  <tr key={f.id} className="border-t border-line/60">
                    <td className="py-1.5 pr-4 font-medium text-ink">{f.financialYear}</td>
                    <td className="py-1.5 pr-4">{inr(f.turnover)}</td>
                    <td className="py-1.5 pr-4">{inr(f.netWorth)}</td>
                    <td className="py-1.5 pr-4">{inr(f.totalBorrowings)}</td>
                    <td className="py-1.5 pr-4 text-ink-muted">{humanize(f.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title="Addresses" empty="No addresses.">
          {e.addresses.map((a) => (
            <Row key={a.id} left={humanize(a.addressType)} right={[a.line1, a.city, a.pincode].filter(Boolean).join(', ')} badge={a.isPrimary ? 'Primary' : undefined} />
          ))}
        </ListCard>
        <ListCard title="Ownership & relationships" empty="No relationships wired.">
          {e.relationships.map((r) => (
            <Row
              key={r.id}
              left={humanize(r.relationshipType)}
              right={`${r.toEntityLegalName}${r.shareholdingPct !== null ? ` · ${r.shareholdingPct}%` : ''}`}
            />
          ))}
        </ListCard>
        <ListCard title="Business activities" empty="No industries classified.">
          {e.businessActivities.map((a) => (
            <Row key={a.id} left={a.industryName} right={a.nicCode ?? ''} badge={a.isPrimary ? 'Primary' : undefined} />
          ))}
        </ListCard>
        <ListCard title="Listings" empty="Unlisted / no lines.">
          {e.listings.map((l) => (
            <Row key={l.id} left={`${l.exchange.toUpperCase()} · ${humanize(l.securityType)}`} right={l.symbol ?? humanize(l.status)} />
          ))}
        </ListCard>
        <ListCard title="Regulatory facts" empty="No structured facts recorded.">
          {e.regulatoryAttributes.map((a) => (
            <Row
              key={a.id}
              left={a.attributeName}
              right={
                a.valueText ??
                (a.valueBoolean !== null ? (a.valueBoolean ? 'Yes' : 'No') : (a.valueNumber?.toString() ?? '—'))
              }
            />
          ))}
        </ListCard>
        <ListCard title="Activities" empty="">
          {(Object.entries(e.activities).filter(([, v]) => v) as [string, boolean][]).map(([k]) => (
            <span key={k} className="mr-1.5 inline-block rounded-md bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">
              {humanize(k)}
            </span>
          ))}
        </ListCard>
      </div>

      {/* Regulatory Profile (§20–§22) — read-only, downstream. */}
      <Card>
        <CardHeader>
          <CardTitle>Regulatory profile</CardTitle>
        </CardHeader>
        <CardBody>
          <RegulatoryProfile entity={e} />
        </CardBody>
      </Card>

      <section>
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

      <p className="text-xs text-ink-faint">
        <Link href="/entities" className="text-primary-600 hover:underline">
          ← Back to entities
        </Link>
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Card>
      <CardBody className="py-3">
        <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="mt-0.5 font-medium text-ink">{value}</div>
      </CardBody>
    </Card>
  );
}

function ListCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}): JSX.Element {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-1.5 text-sm">
        {hasContent ? children : <p className="text-ink-faint">{empty || '—'}</p>}
      </CardBody>
    </Card>
  );
}

function Row({ left, right, badge }: { left: string; right: string; badge?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-muted">{left}</span>
      <span className="flex items-center gap-2">
        {right && <span className="font-medium text-ink">{right}</span>}
        {badge && <Badge tone="info">{badge}</Badge>}
      </span>
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
