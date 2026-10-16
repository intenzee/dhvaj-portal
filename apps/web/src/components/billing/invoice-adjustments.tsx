'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MinusCircle } from 'lucide-react';
import {
  GST_RATES,
  PERMISSION,
  type AdjustmentKind,
  type InvoiceAdjustment,
  type InvoiceDetail,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { useBillingSettings } from './invoice-gst';
import {
  adjustmentKindLabel,
  adjustmentPreview,
  adjustmentStatusLabel,
  topGstRate,
} from './adjustments';

/**
 * PS-205 · On an issued invoice: its credit notes and write-offs, and (with
 * billing.manage) a request to reduce the bill, which a partner who did not
 * ask approves before the balance moves.
 */
export function InvoiceAdjustments({
  invoice,
  onChanged,
}: {
  invoice: InvoiceDetail;
  onChanged: () => void;
}): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { settings } = useBillingSettings();
  const [asking, setAsking] = useState(false);
  const [kind, setKind] = useState<AdjustmentKind>('write_off');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState(String(topGstRate(invoice.lines)));
  const [reason, setReason] = useState('');

  const key = ['billing', 'adjustments', invoice.id] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<InvoiceAdjustment[]>(`/billing/adjustments?invoiceId=${invoice.id}`),
  });
  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  const mayAsk = open && can(principal, PERMISSION.billingManage);
  const preview = adjustmentPreview(kind, amount, invoice, {
    firmState: settings?.stateCode ?? null,
    rate: Number(rate),
  });

  const ask = useMutation({
    mutationFn: () =>
      kind === 'write_off'
        ? apiFetch<InvoiceAdjustment>(`/billing/invoices/${invoice.id}/write-offs`, {
            method: 'POST',
            body: { amount: amount.trim(), reason: reason.trim() },
          })
        : apiFetch<InvoiceAdjustment>(`/billing/invoices/${invoice.id}/credit-notes`, {
            method: 'POST',
            body: { taxableValue: amount.trim(), gstRate: Number(rate), reason: reason.trim() },
          }),
    onSuccess: (a) => {
      toast(
        `${adjustmentKindLabel(a.kind)} of ${formatMoney(a.total, 'INR')} sent to a partner to approve.`,
      );
      setAsking(false);
      setAmount('');
      setReason('');
      void qc.invalidateQueries({ queryKey: key });
      onChanged();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not send the request.', 'error'),
  });

  const rows = list.data ?? [];
  if (!mayAsk && rows.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Credit notes and write-offs</span>
        {mayAsk && !asking && (
          <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
            <MinusCircle className="h-4 w-4" /> Reduce the bill
          </Button>
        )}
      </div>
      {rows.length === 0 && !asking && (
        <p className="text-xs text-ink-faint">
          None. A reduction needs a partner&rsquo;s approval.
        </p>
      )}
      {rows.map((a) => (
        <div key={a.id} className="rounded-md border border-line px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-ink">
              {adjustmentKindLabel(a.kind)}
              {a.number ? ` ${a.number}` : ''}
            </span>
            <span className="tabular-nums">{formatMoney(a.total, 'INR')}</span>
            {a.kind === 'credit_note' && a.total !== a.taxableValue && (
              <span className="text-xs text-ink-faint">
                {formatMoney(a.taxableValue, 'INR')} + GST {Number(a.gstRate)}%
              </span>
            )}
            <Badge
              tone={
                a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warn' : 'neutral'
              }
            >
              {adjustmentStatusLabel(a.status)}
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {a.requestedByName ?? 'Someone'} asked {formatDate(a.requestedAt)}: {a.reason}
            {a.decidedByName &&
              ` · ${a.status === 'approved' ? 'approved' : 'rejected'} by ${a.decidedByName}${a.decisionNote ? ` (${a.decisionNote})` : ''}`}
          </div>
        </div>
      ))}
      {asking && (
        <div className="space-y-3 rounded-md border border-line p-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Kind">
              <Select value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
                <option value="write_off">Write-off</option>
                <option value="credit_note">Credit note (GST)</option>
              </Select>
            </Field>
            <Field label={kind === 'write_off' ? 'Amount' : 'Taxable value'}>
              <Input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            {kind === 'credit_note' && (
              <Field label="GST rate">
                <Select value={rate} onChange={(e) => setRate(e.target.value)}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={String(r)}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Field label="Why?" hint="The partner sees this when deciding.">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex items-center justify-end gap-3 text-sm">
            {amount.trim() &&
              (preview.ok ? (
                <span className="text-ink-muted">
                  Comes off the balance:{' '}
                  <span className="font-medium text-ink">{formatMoney(preview.total, 'INR')}</span>
                  {preview.total !== preview.taxable && ' (with GST)'}
                </span>
              ) : (
                <span className="text-danger-600">{preview.error}</span>
              ))}
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => ask.mutate()}
              disabled={!preview.ok || !reason.trim() || ask.isPending}
            >
              Send for approval
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
