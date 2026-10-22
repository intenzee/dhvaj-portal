'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { FEATURE_FLAG, PERMISSION, type EngagementCommercialView } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatDuration, formatMoney, humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { CreateInvoiceModal, InvoiceDetailModal } from '@/components/actions/invoices-section';
import { canReadAccounts } from '@/components/accounts/accounts';

/**
 * Accountant role · an engagement's commercial view (spec §3.4): who leads it,
 * the agreed fees, billable hours by person and the invoices. No tasks,
 * documents, review notes, time-entry notes or activity.
 */
export default function EngagementCommercialPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { principal } = useAuth();
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  const allowed = canReadAccounts(principal);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const key = ['billing', 'engagement', id] as const;
  const view = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<EngagementCommercialView>(`/billing/engagements/${id}`),
    enabled: v2 && allowed,
  });
  const changed = (): void => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['billing'] });
  };

  if (!allowed || !v2) {
    return (
      <EmptyState>
        {allowed
          ? 'The commercial view arrives with the new billing.'
          : 'You don’t have permission to view the firm’s billing.'}
      </EmptyState>
    );
  }
  if (view.isLoading) return <Spinner />;
  if (view.error || !view.data) {
    return (
      <EmptyState>
        {view.error instanceof ApiError ? view.error.message : 'Could not load the engagement.'}
      </EmptyState>
    );
  }
  const e = view.data;
  const currency = e.currency ?? 'INR';
  const facts: [string, string | null][] = [
    ['Service', e.serviceName],
    ['Period', e.periodLabel ?? e.financialYear],
    ['Status', humanize(e.status)],
    ['Billing', humanize(e.billingModel)],
    ['Partner', e.partner?.name ?? null],
    ['Manager', e.manager?.name ?? null],
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title={`${e.engagementCode} · ${e.clientName}`}
        subtitle="The commercial side of this engagement: agreed fees, billable hours and invoices."
        back={{ href: `/billing/statements/${e.clientId}`, label: e.clientName }}
        actions={
          can(principal, PERMISSION.billingManage) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-6">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="mt-0.5 text-ink">{value || <span className="text-ink-faint">—</span>}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card className="p-0">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Agreed fees</CardTitle>
          <Link href="/billing/unbilled" className="text-xs text-primary-700 hover:underline">
            Unbilled fees
          </Link>
        </CardHeader>
        {e.feeMilestones.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-faint">No fee milestones; any retainer or year fee shows under Unbilled fees.</p>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2">Fee</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {e.feeMilestones.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink">{m.description}</td>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(m.dueOn)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Billable hours</CardTitle>
        </CardHeader>
        {e.hours.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-faint">No billable time logged.</p>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2">Person</th>
                <th className="px-4 py-2 text-right">Billable</th>
                <th className="px-4 py-2 text-right">Billed</th>
                <th className="px-4 py-2 text-right">Unbilled</th>
                <th className="px-4 py-2 text-right">Last rate / hour</th>
              </tr>
            </thead>
            <tbody>
              {e.hours.map((h) => (
                <tr key={h.employeeId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink">{h.employeeName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatDuration(h.billableSeconds)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                    {formatDuration(h.billedSeconds)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatDuration(h.unbilledSeconds)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                    {h.lastRatePerHour ? formatMoney(h.lastRatePerHour, currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        {e.invoices.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-faint">No invoices yet.</p>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2">Number</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Issued</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {e.invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-sunken"
                  onClick={() => setOpenInvoice(inv.id)}
                >
                  <td className="px-4 py-2 font-medium text-ink">
                    <FileText className="mr-1.5 inline h-3.5 w-3.5 text-ink-faint" aria-hidden />
                    {inv.invoiceNumber ?? <span className="font-normal italic text-ink-faint">Draft</span>}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(inv.issueDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(inv.total, currency)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatMoney(inv.balance, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <CreateInvoiceModal
          engagementId={id}
          onClose={() => setCreating(false)}
          onCreated={(invoiceId) => {
            changed();
            setCreating(false);
            setOpenInvoice(invoiceId);
          }}
        />
      )}
      {openInvoice && (
        <InvoiceDetailModal
          engagementId={id}
          invoiceId={openInvoice}
          onClose={() => setOpenInvoice(null)}
          onChanged={changed}
        />
      )}
    </div>
  );
}
