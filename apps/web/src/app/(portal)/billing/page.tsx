'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  INVOICE_STATUSES,
  PERMISSION,
  type BillingSummary,
  type GlobalInvoiceRecord,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize, formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import { PageHeader, Spinner, Card, EmptyState, Badge } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';

const PAGE_SIZE = 25;

export default function BillingPage(): JSX.Element {
  const { principal } = useAuth();

  if (!can(principal, PERMISSION.reportRead)) {
    return (
      <div>
        <PageHeader title="Billing & Collections" />
        <EmptyState>You don’t have permission to view firm billing.</EmptyState>
      </div>
    );
  }
  return <Billing />;
}

function Billing(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const reset = (fn: () => void): void => {
    fn();
    setOffset(0);
  };

  const summary = useQuery({
    queryKey: ['billing', 'summary'],
    queryFn: () => apiFetch<BillingSummary>('/invoices/summary'),
  });

  const list = useQuery({
    queryKey: ['billing', 'invoices', search, status, overdueOnly, offset],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (overdueOnly) params.set('overdueOnly', 'true');
      return apiFetch<Paginated<GlobalInvoiceRecord>>(`/invoices?${params.toString()}`);
    },
  });

  const columns: ColumnDef<GlobalInvoiceRecord, unknown>[] = [
    {
      header: 'Invoice',
      cell: ({ row }) => (
        <span className="font-medium tabular-nums text-ink">{row.original.invoiceNumber}</span>
      ),
    },
    {
      header: 'Client',
      cell: ({ row }) => row.original.entityName ?? <span className="text-ink-faint">—</span>,
    },
    {
      header: 'Engagement',
      cell: ({ row }) => (
        <Link
          href={`/engagements/${row.original.engagementId}`}
          className="font-medium text-primary-700 hover:underline"
        >
          {row.original.engagementCode}
        </Link>
      ),
    },
    { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      header: 'Total',
      cell: ({ row }) => (
        <span className="tabular-nums">{formatMoney(row.original.total, row.original.currency)}</span>
      ),
    },
    { header: 'Issued', cell: ({ row }) => formatDate(row.original.issueDate) },
    {
      header: 'Due',
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {formatDate(row.original.dueDate)}
          {row.original.overdue && <Badge tone="danger">Overdue</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Billing & Collections"
        subtitle="Invoices across everything you can see, with what’s outstanding and overdue. Scoped by the database; issue and record payment on each engagement’s Invoices tab."
      />

      {summary.data && <SummaryCards s={summary.data} />}

      <div className="mb-3 mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => reset(() => setSearch(e.target.value))}
          placeholder="Search number, client or engagement…"
          className="w-full max-w-xs rounded-md border border-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <FilterChip label="All" active={status === '' && !overdueOnly} onClick={() => reset(() => { setStatus(''); setOverdueOnly(false); })} />
        {INVOICE_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={humanize(s)}
            active={status === s && !overdueOnly}
            onClick={() => reset(() => { setStatus(s); setOverdueOnly(false); })}
          />
        ))}
        <FilterChip label="Overdue" active={overdueOnly} onClick={() => reset(() => { setOverdueOnly(true); setStatus(''); })} />
      </div>

      <Card className="p-0">
        {list.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {list.data && (
          <DataTable columns={columns} data={list.data.items} empty="No invoices match this view." />
        )}
      </Card>
      {list.data && (
        <Pagination
          total={list.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="invoices"
        />
      )}
    </div>
  );
}

function SummaryCards({ s }: { s: BillingSummary }): JSX.Element {
  const tiles: { label: string; value: string; sub: string; tone?: 'danger' | 'warn' | 'success' }[] = [
    { label: 'Outstanding', value: formatMoney(s.outstanding.amount, s.currency), sub: `${s.outstanding.count} issued`, tone: 'warn' },
    { label: 'Overdue', value: formatMoney(s.overdue.amount, s.currency), sub: `${s.overdue.count} past due`, tone: 'danger' },
    { label: 'Paid', value: formatMoney(s.paid.amount, s.currency), sub: `${s.paid.count} settled`, tone: 'success' },
    { label: 'Draft', value: formatMoney(s.draft.amount, s.currency), sub: `${s.draft.count} not issued` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
          <div className="text-[13px] font-medium text-ink-muted">{t.label}</div>
          <div
            className={cn(
              'mt-1 text-2xl font-bold tabular-nums',
              t.tone === 'danger'
                ? 'text-danger-600'
                : t.tone === 'warn'
                  ? 'text-warning-700'
                  : t.tone === 'success'
                    ? 'text-success-700'
                    : 'text-ink',
            )}
          >
            {t.value}
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">{t.sub}</div>
        </div>
      ))}
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
