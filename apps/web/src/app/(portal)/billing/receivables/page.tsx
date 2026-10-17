'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  PERMISSION,
  RECEIVABLE_BANDS,
  RECEIVABLE_BAND_LABEL,
  type ReceivableRow,
  type ReceivablesReport,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { oldestLine } from '@/components/billing/receivables';

type View = 'partner' | 'client';

/**
 * PS-203 · who owes what and for how long: each engagement partner's and each
 * client's balance by age band (from the due date), the oldest invoice and
 * the last receipt — over-90 first.
 */
export default function ReceivablesPage(): JSX.Element {
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.billing);
  const allowed = can(principal, PERMISSION.billingManage) || can(principal, PERMISSION.reportRead);
  const [view, setView] = useState<View>('partner');
  const q = useQuery({
    queryKey: ['reports', 'receivables'],
    queryFn: () => apiFetch<ReceivablesReport>('/reports/receivables'),
    enabled: on && allowed,
  });

  if (!on) return <EmptyState>Receivables arrive with the new billing.</EmptyState>;
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Receivables" />
        <EmptyState>You don’t have permission to view receivables.</EmptyState>
      </div>
    );
  }

  const rows = view === 'partner' ? q.data?.byPartner : q.data?.byClient;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receivables"
        subtitle={
          q.data
            ? `Open balances by age from the due date, as at ${formatDate(q.data.asOf)}. Over 90 days first.`
            : 'Open balances by age from the due date.'
        }
      />
      <div className="flex items-center gap-2 text-sm">
        <Link href="/billing" className="text-primary-700 hover:underline">
          ← Billing
        </Link>
        <div role="tablist" className="ml-auto flex rounded-lg border border-line p-0.5">
          {(['partner', 'client'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                view === v ? 'bg-primary-50 font-medium text-primary-700' : 'text-ink-muted',
              )}
            >
              By {v === 'partner' ? 'engagement partner' : 'client'}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading && <Spinner label="Ageing the receivables…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the receivables.'}
        </EmptyState>
      )}
      {q.data && rows && (
        <Card className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              Nothing is owed on the clients you bill.
            </p>
          ) : (
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {view === 'partner' ? 'Engagement partner' : 'Client'}
                  </th>
                  {RECEIVABLE_BANDS.map((b) => (
                    <th key={b} className="px-3 py-2 text-right">
                      {RECEIVABLE_BAND_LABEL[b]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right text-danger-700">Over 90</th>
                  <th className="px-3 py-2 text-left">Oldest</th>
                  {view === 'client' && <th className="px-3 py-2 text-left">Last receipt</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <Row key={r.id ?? 'none'} r={r} view={view} />
                ))}
              </tbody>
              <tfoot className="border-t border-line-strong font-medium">
                <tr>
                  <td className="px-3 py-2">All</td>
                  {RECEIVABLE_BANDS.map((b) => (
                    <td key={b} className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(q.data.totals[b], 'INR')}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(q.data.totals.total, 'INR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger-700">
                    {formatMoney(q.data.totals.over90, 'INR')}
                  </td>
                  <td colSpan={view === 'client' ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function Row({ r, view }: { r: ReceivableRow; view: View }): JSX.Element {
  const o = r.oldestInvoice;
  return (
    <tr>
      <td className="px-3 py-2">
        {view === 'client' && r.id ? (
          <Link href={`/billing/clients/${r.id}`} className="font-medium text-ink hover:underline">
            {r.name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{r.name}</span>
        )}
        <span className="block text-xs text-ink-faint">
          {r.openInvoices} open invoice{r.openInvoices === 1 ? '' : 's'}
        </span>
      </td>
      {RECEIVABLE_BANDS.map((b) => (
        <td
          key={b}
          className={cn(
            'px-3 py-2 text-right tabular-nums',
            Number(r.bands[b]) === 0 && 'text-ink-faint',
          )}
        >
          {Number(r.bands[b]) === 0 ? '—' : formatMoney(r.bands[b], 'INR')}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-medium tabular-nums">
        {formatMoney(r.total, 'INR')}
      </td>
      <td
        className={cn(
          'px-3 py-2 text-right tabular-nums',
          Number(r.over90) > 0 ? 'font-medium text-danger-700' : 'text-ink-faint',
        )}
      >
        {Number(r.over90) === 0 ? '—' : formatMoney(r.over90, 'INR')}
      </td>
      <td className="px-3 py-2">
        {o ? (
          <Link href={`/engagements/${o.engagementId}`} className="hover:underline">
            {oldestLine(o)}
          </Link>
        ) : (
          '—'
        )}
      </td>
      {view === 'client' && (
        <td className="px-3 py-2 text-ink-muted">
          {r.lastReceipt
            ? `${formatMoney(r.lastReceipt.amount, 'INR')} on ${formatDate(r.lastReceipt.date)}`
            : 'None'}
        </td>
      )}
    </tr>
  );
}
