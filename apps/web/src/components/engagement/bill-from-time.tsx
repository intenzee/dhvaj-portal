'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  STREAM_LABEL,
  hoursOf,
  timeBillingLines,
  type BillableTimeReport,
  type InvoiceDetail,
  type Stream,
  type TimeSummary,
  type TimeSummaryRow,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Input } from '@/components/form';
import {
  linesTotal,
  pickedEntries,
  pickedStreams,
  timeStatusLine,
} from '@/components/billing/time-billing';

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
 * With billing v2 on, time is billed once (PS-206 fix): see BilledOnceTime.
 */
export function BillFromTime({ engagementId }: { engagementId: string }): JSX.Element {
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  return v2 ? (
    <BilledOnceTime engagementId={engagementId} />
  ) : (
    <SummaryTime engagementId={engagementId} />
  );
}

function SummaryTime({ engagementId }: { engagementId: string }): JSX.Element {
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

/**
 * PS-206 (fix) · each stopped, billable entry with where it stands: unbilled
 * (ticked to bill), on which invoice, or waiting on a correction. Raising the
 * draft puts only the ticked entries on it, and the server refuses any already
 * on a live invoice; voiding the invoice or removing its line frees them.
 */
function BilledOnceTime({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rates, setRates] = useState<Record<string, string>>({});
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  // Under 'invoices' so voiding an invoice or removing a line refreshes it.
  const report = useQuery({
    queryKey: ['engagement', engagementId, 'invoices', 'time', qs.toString()],
    queryFn: () =>
      apiFetch<BillableTimeReport>(`/billing/engagements/${engagementId}/time?${qs.toString()}`),
    enabled: open,
  });
  const entries = report.data?.entries ?? [];
  const picked = pickedEntries(entries, unticked);
  const streams = pickedStreams(picked);
  const period = from || to ? `${from || '…'} to ${to || '…'}` : '';
  const { lines, unpriced } = timeBillingLines(picked, rates, period);
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const raise = useMutation({
    mutationFn: () =>
      apiFetch<InvoiceDetail>(`/billing/engagements/${engagementId}/time/draft`, {
        method: 'POST',
        body: {
          entryIds: picked.map((e) => e.entryId),
          rates: streams.map((s) => ({ stream: s.key, ratePerHour: rates[s.key] ?? '' })),
          ...(period ? { period } : {}),
        },
      }),
    onSuccess: () => {
      toast('Draft invoice raised from time.');
      setUnticked(new Set());
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'invoices'] });
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'tabs'] });
    },
    onError: (err) => {
      toast(err instanceof ApiError ? err.message : 'Could not raise the invoice.', 'error');
      void report.refetch();
    },
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
          {report.isLoading ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <EmptyState>No billable time in this range.</EmptyState>
          ) : (
            <>
              <p className="text-ink-muted">
                Unbilled {hoursOf(report.data?.unbilledSeconds ?? 0)} h · on invoices{' '}
                {hoursOf(report.data?.billedSeconds ?? 0)} h
              </p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                    <th className="w-6 py-1.5" />
                    <th className="py-1.5 font-semibold">Date</th>
                    <th className="py-1.5 font-semibold">Who</th>
                    <th className="py-1.5 font-semibold">Stream</th>
                    <th className="py-1.5 font-semibold">Work</th>
                    <th className="py-1.5 text-right font-semibold">Hours</th>
                    <th className="py-1.5 font-semibold">Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.entryId} className="border-b border-line last:border-0">
                      <td className="py-1.5">
                        {e.status === 'unbilled' && (
                          <input
                            type="checkbox"
                            aria-label={`Bill ${e.employeeName}, ${formatDate(e.workedOn)}`}
                            checked={!unticked.has(e.entryId)}
                            onChange={() => toggle(e.entryId)}
                          />
                        )}
                      </td>
                      <td className="py-1.5">{formatDate(e.workedOn)}</td>
                      <td className="py-1.5">{e.employeeName}</td>
                      <td className="py-1.5">{e.streamLabel}</td>
                      <td className="py-1.5 text-ink-muted">{e.taskTitle ?? e.note ?? e.category ?? '—'}</td>
                      <td className="py-1.5 text-right">{hoursOf(e.seconds)}</td>
                      <td className={e.status === 'unbilled' ? 'py-1.5' : 'py-1.5 text-ink-muted'}>
                        {timeStatusLine(e)}
                        {e.status === 'billed' && e.billedRatePerHour && ` at ${formatMoney(e.billedRatePerHour)}/h`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {streams.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  {streams.map((s) => (
                    <label key={s.key} className="flex items-center gap-2">
                      <span className="text-ink-muted">{s.label} rate / hour</span>
                      <Input
                        className="w-28 text-right"
                        inputMode="decimal"
                        aria-label={`Rate for ${s.label}`}
                        value={rates[s.key] ?? ''}
                        onChange={(e) => setRates({ ...rates, [s.key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={picked.length === 0 || unpriced.length > 0 || lines.length === 0 || raise.isPending}
              onClick={() => raise.mutate()}
            >
              Raise draft invoice
            </Button>
            {lines.length > 0 && unpriced.length === 0 && (
              <span className="text-ink-muted">Before tax: {formatMoney(linesTotal(lines))}</span>
            )}
            {unpriced.length > 0 && picked.length > 0 && (
              <span className="text-ink-muted">Type an hourly rate for {unpriced.join(', ')}.</span>
            )}
          </div>
        </CardBody>
      )}
    </Card>
  );
}
