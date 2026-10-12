'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STREAM_LABEL, type Stream, type TimeSummary, type TimeSummaryRow } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Input } from '@/components/form';

/** Billable hours (2 dp) of a summary row. */
export function billableHours(r: Pick<TimeSummaryRow, 'billableSeconds'>): number {
  return Math.round((r.billableSeconds / 3600) * 100) / 100;
}

/**
 * Invoice lines from billable time per stream at the given hourly rates.
 * Rows with no billable time or no rate are left out. Pure — tested.
 */
export function linesFromTime(
  rows: TimeSummaryRow[],
  rates: Record<string, string>,
  period: string,
): { description: string; quantity: string; unitAmount: string; sortOrder: number }[] {
  return rows
    .filter((r) => billableHours(r) > 0 && Number(rates[r.key]) > 0)
    .map((r, i) => ({
      description: `${STREAM_LABEL[r.key as Stream] ?? r.label} — professional time${period ? ` (${period})` : ''}`,
      quantity: billableHours(r).toFixed(2),
      unitAmount: Number(rates[r.key]).toFixed(2),
      sortOrder: i,
    }));
}

/**
 * Change 3 — Invoices → "Bill from time": billable hours per stream for a date
 * range, an hourly rate per stream, and one click to raise a draft invoice
 * with a line per stream. The draft is then edited in the invoice list.
 */
export function BillFromTime({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const qs = new URLSearchParams({ by: 'stream' });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const summary = useQuery({
    queryKey: ['time', 'summary', engagementId, qs.toString()],
    queryFn: () => apiFetch<TimeSummary>(`/engagements/${engagementId}/time/summary?${qs.toString()}`),
    enabled: open,
  });
  const rows = (summary.data?.rows ?? []).filter((r) => r.billableSeconds > 0);
  const period = from || to ? `${from || '…'} to ${to || '…'}` : '';
  const lines = linesFromTime(rows, rates, period);
  const total = lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitAmount), 0);

  const raise = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/invoices`, {
        method: 'POST',
        body: { lines, notes: `Billed from recorded time${period ? `, ${period}` : ''}.` },
      }),
    onSuccess: () => {
      toast('Draft invoice raised from time.');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'invoices'] });
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'tabs'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not raise the invoice.', 'error'),
  });

  return (
    <Card className="mb-4">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Bill from time</CardTitle>
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '−' : '+'} Bill from time
        </Button>
      </CardHeader>
      {open && (
        <CardBody className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted">Time from</span>
            <Input className="w-auto" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-ink-muted">to</span>
            <Input className="w-auto" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {summary.isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState>No billable time in this range.</EmptyState>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-1.5 font-semibold">Stream</th>
                  <th className="py-1.5 text-right font-semibold">Billable hours</th>
                  <th className="py-1.5 text-right font-semibold">Rate / hour</th>
                  <th className="py-1.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line last:border-0">
                    <td className="py-1.5">{STREAM_LABEL[r.key as Stream] ?? r.label}</td>
                    <td className="py-1.5 text-right">{billableHours(r)}</td>
                    <td className="py-1.5 text-right">
                      <Input
                        className="ml-auto w-28 text-right"
                        inputMode="decimal"
                        aria-label={`Rate for ${r.label}`}
                        value={rates[r.key] ?? ''}
                        onChange={(e) => setRates({ ...rates, [r.key]: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {Number(rates[r.key]) > 0 ? formatMoney(billableHours(r) * Number(rates[r.key])) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={lines.length === 0 || raise.isPending} onClick={() => raise.mutate()}>
              Raise draft invoice
            </Button>
            {lines.length > 0 && <span className="text-ink-muted">Before tax: {formatMoney(total)}</span>}
          </div>
        </CardBody>
      )}
    </Card>
  );
}
