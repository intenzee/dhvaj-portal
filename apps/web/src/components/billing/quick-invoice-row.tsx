'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, Zap } from 'lucide-react';
import {
  QUICK_INVOICE_DEFAULT_GST_RATE,
  QUICK_INVOICE_GST_RATES,
  RECURRING_INVOICE_MODE,
  type InvoiceService,
  type QuickInvoiceGstRate,
  type QuickInvoiceInput,
  type QuickInvoiceResult,
  type SetRecurringInvoiceInput,
  quickInvoiceTotals,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { istToday } from '@/lib/people';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Input, Select } from '@/components/form';
import { InvoiceSend } from './invoice-send';

const inr = (n: number): string =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** "GST compliance · FY 2026-27 · Q3" — how a service reads in the drop-down. Pure — tested. */
export function serviceLabel(s: InvoiceService): string {
  return [s.name, s.financialYear ? `FY ${s.financialYear}` : null, s.periodLabel]
    .filter(Boolean)
    .join(' · ');
}

/** "₹15,000 + 18% GST ₹2,700 = ₹17,700"; null until the amount is a number above 0. Pure — tested. */
export function quickPreview(amount: string, rate: number): string | null {
  const t = quickInvoiceTotals(amount, rate);
  if (!t) return null;
  return rate === 0
    ? `${inr(t.taxable)}, no GST`
    : `${inr(t.taxable)} + ${rate}% GST ${inr(t.tax)} = ${inr(t.total)}`;
}

/** The day a "repeat monthly" schedule takes: today's, up to the 28th. Pure — tested. */
export function repeatDay(isoToday: string): number {
  return Math.min(Number(isoToday.slice(8, 10)), 28);
}

/**
 * Quick invoices · one row: a service already on the engagement, the amount,
 * the GST rate, Enter. Issued at once when the person may issue it; otherwise
 * a draft with the reason (who issues it). Then send it, or repeat it monthly.
 */
export function QuickInvoiceRow({
  engagementId,
  onCreated,
}: {
  engagementId: string;
  onCreated: () => void;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const servicesKey = ['engagement', engagementId, 'invoice-services'] as const;
  const services = useQuery({
    queryKey: servicesKey,
    queryFn: () => apiFetch<InvoiceService[]>(`/engagements/${engagementId}/invoice-services`),
  });
  const [serviceId, setServiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState<QuickInvoiceGstRate>(QUICK_INVOICE_DEFAULT_GST_RATE);
  const [last, setLast] = useState<
    (QuickInvoiceResult & { engagementServiceId: string; amount: string; rate: QuickInvoiceGstRate }) | null
  >(null);

  const list = services.data ?? [];
  const chosen = serviceId || (list.length === 1 ? list[0]!.engagementServiceId : '');
  const preview = quickPreview(amount, rate);

  const pick = (id: string): void => {
    setServiceId(id);
    const s = list.find((x) => x.engagementServiceId === id)?.schedule;
    if (s) {
      setAmount(String(Number(s.amount)));
      setRate(s.gstRate as QuickInvoiceGstRate);
    }
  };

  const create = useMutation({
    mutationFn: (input: QuickInvoiceInput) =>
      apiFetch<QuickInvoiceResult>(`/engagements/${engagementId}/invoices/quick`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (r, input) => {
      setLast({ ...r, engagementServiceId: input.engagementServiceId, amount: input.amount, rate });
      setAmount('');
      onCreated();
      toast(
        r.issued
          ? `Issued ${r.invoice.invoiceNumber}.`
          : `Saved as a draft${r.notIssuedReason ? ` — ${r.notIssuedReason}` : '.'}`,
      );
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not make the invoice.', 'error'),
  });

  const repeat = useMutation({
    mutationFn: (p: { serviceId: string; body: SetRecurringInvoiceInput }) =>
      apiFetch(`/engagements/${engagementId}/invoice-services/${p.serviceId}/schedule`, {
        method: 'PUT',
        body: p.body,
      }),
    onSuccess: (_r, p) => {
      void qc.invalidateQueries({ queryKey: servicesKey });
      toast(`This invoice now goes out on the ${ordinal(p.body.dayOfMonth)} of every month.`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not set it monthly.', 'error'),
  });

  if (services.isLoading) return null;
  if (list.length === 0) {
    return (
      <p className="mb-2 text-xs text-ink-faint">
        Add a service to this engagement to make an invoice from it in one line.
      </p>
    );
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!chosen || !preview || create.isPending) return;
    create.mutate({ engagementServiceId: chosen, amount: amount.trim(), gstRate: rate });
  };

  const lastScheduled = last
    ? list.find((s) => s.engagementServiceId === last.engagementServiceId)?.schedule
    : null;

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-raised p-3" data-testid="quick-invoice">
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <Zap className="h-4 w-4 text-primary-600" aria-hidden />
        <Select
          className="min-w-[14rem] flex-1"
          aria-label="Service"
          value={chosen}
          onChange={(e) => pick(e.target.value)}
        >
          {list.length > 1 && <option value="">Service…</option>}
          {list.map((s) => (
            <option key={s.engagementServiceId} value={s.engagementServiceId}>
              {serviceLabel(s)}
            </option>
          ))}
        </Select>
        <Input
          className="w-32"
          aria-label="Amount before GST"
          inputMode="decimal"
          placeholder="Amount ₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          className="w-24"
          aria-label="GST rate"
          value={String(rate)}
          onChange={(e) => setRate(Number(e.target.value) as QuickInvoiceGstRate)}
        >
          {QUICK_INVOICE_GST_RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}% GST
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={!chosen || !preview || create.isPending}>
          Make invoice ↵
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-ink-muted">
        {preview ?? 'Pick the service, type the amount before GST and press Enter.'}
      </p>

      {last && (
        <div className="mt-3 space-y-2 border-t border-line pt-3" data-testid="quick-invoice-result">
          <p className="text-sm text-ink">
            {last.issued ? (
              <>
                Issued <span className="font-medium">{last.invoice.invoiceNumber}</span> — send it to
                the client:
              </>
            ) : (
              <>
                Saved as a draft. {last.notIssuedReason ?? ''} Open it below to issue it.
              </>
            )}
          </p>
          {last.issued && last.invoice.invoiceNumber && (
            <InvoiceSend
              engagementId={engagementId}
              invoiceId={last.invoice.id}
              invoiceNumber={last.invoice.invoiceNumber}
            />
          )}
          {!lastScheduled && (
            <Button
              size="sm"
              variant="ghost"
              disabled={repeat.isPending}
              onClick={() =>
                repeat.mutate({
                  serviceId: last.engagementServiceId,
                  body: {
                    amount: last.amount,
                    gstRate: last.rate,
                    dayOfMonth: repeatDay(istToday()),
                    mode: RECURRING_INVOICE_MODE.active,
                  },
                })
              }
            >
              <Repeat className="h-4 w-4" /> Repeat this every month
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** 1 → '1st', 22 → '22nd'. Pure — tested. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
