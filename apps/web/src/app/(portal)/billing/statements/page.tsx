'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_FLAG, type BillingClientRow } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { canReadAccounts } from '@/components/accounts/accounts';

/** Accountant role · Client statements (spec §3.4): every client the caller bills. */
export default function StatementsPage(): JSX.Element {
  const { principal } = useAuth();
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  const allowed = canReadAccounts(principal);
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(true);

  const term = q.trim();
  const list = useQuery({
    queryKey: ['billing', 'clients', term, owing],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200', owing: String(owing) });
      if (term) params.set('q', term);
      return apiFetch<BillingClientRow[]>(`/billing/clients?${params.toString()}`);
    },
    enabled: v2 && allowed,
  });

  if (!allowed || !v2) {
    return (
      <div>
        <PageHeader title="Client statements" />
        <EmptyState>
          {allowed
            ? 'Client statements arrive with the new billing.'
            : 'You don’t have permission to view the firm’s billing.'}
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Client statements"
        subtitle="Each client you bill: billing profile, invoices, receipts, TDS and the balance. Largest balance first."
        back={{ href: '/accounts', label: 'Accounts desk' }}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          placeholder="Search name, code or GSTIN…"
          aria-label="Search clients"
          className="w-full max-w-xs rounded-md border border-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="button"
          aria-pressed={owing}
          onClick={() => setOwing((o) => !o)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition',
            owing
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
          )}
        >
          With a balance
        </button>
      </div>
      <Card className="p-0">
        {list.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {list.error && (
          <div className="p-4 text-sm text-danger-700">
            {list.error instanceof ApiError ? list.error.message : 'Could not load the clients.'}
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <p className="p-4 text-sm text-ink-faint">
            {owing ? 'No client owes anything here.' : 'No clients match.'}
          </p>
        )}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">GSTIN</th>
                <th className="px-4 py-2 text-right">Open invoices</th>
                <th className="px-4 py-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/billing/statements/${c.id}`} className="font-medium text-primary-700 hover:underline">
                      {c.legalName}
                    </Link>
                    <span className="ml-2 text-xs text-ink-faint">{c.entityCode}</span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-ink-muted">{c.gstin ?? 'Unregistered'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.openInvoices}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatMoney(c.outstanding, 'INR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
