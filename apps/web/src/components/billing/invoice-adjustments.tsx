'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, MinusCircle } from 'lucide-react';
import {
  PERMISSION,
  type AdjustmentKind,
  type InvoiceAdjustment,
  type InvoiceDetail,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
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
  creditNotePreview,
  creditedByLine,
  mayVoidCreditNote,
  voidLine,
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
  const [lineAmounts, setLineAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const key = ['billing', 'adjustments', invoice.id] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<InvoiceAdjustment[]>(`/billing/adjustments?invoiceId=${invoice.id}`),
  });
  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  const mayAsk = open && can(principal, PERMISSION.billingManage);
  const credited = creditedByLine(list.data ?? []);
  const preview =
    kind === 'write_off'
      ? adjustmentPreview(kind, amount, invoice, { firmState: null, rate: 0 })
      : creditNotePreview(lineAmounts, invoice, settings?.stateCode ?? null, credited);
  const touched =
    kind === 'write_off'
      ? amount.trim() !== ''
      : Object.values(lineAmounts).some((v) => v.trim() !== '');

  const ask = useMutation({
    mutationFn: () =>
      kind === 'write_off'
        ? apiFetch<InvoiceAdjustment>(`/billing/invoices/${invoice.id}/write-offs`, {
            method: 'POST',
            body: { amount: amount.trim(), reason: reason.trim() },
          })
        : apiFetch<InvoiceAdjustment>(`/billing/invoices/${invoice.id}/credit-notes`, {
            method: 'POST',
            body: {
              lines: Object.entries(lineAmounts)
                .filter(([, v]) => v.trim() !== '')
                .map(([invoiceLineId, v]) => ({ invoiceLineId, taxableValue: v.trim() })),
              reason: reason.trim(),
            },
          }),
    onSuccess: (a) => {
      toast(
        `${adjustmentKindLabel(a.kind)} of ${formatMoney(a.total, 'INR')} sent to a partner to approve.`,
      );
      setAsking(false);
      setAmount('');
      setLineAmounts({});
      setReason('');
      void qc.invalidateQueries({ queryKey: key });
      onChanged();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not send the request.', 'error'),
  });

  const voidNote = useMutation({
    mutationFn: (a: InvoiceAdjustment) =>
      apiFetch<InvoiceAdjustment>(`/billing/credit-notes/${a.id}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim(), version: a.version },
      }),
    onSuccess: (a) => {
      toast(`Credit note ${a.number ?? ''} voided; ${formatMoney(a.total, 'INR')} is due again.`);
      setVoidingId(null);
      setVoidReason('');
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['billing'] });
      onChanged();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not void the credit note.', 'error'),
  });
  const me = {
    employeeId: principal?.employeeId ?? null,
    canApprove: can(principal, PERMISSION.billingApprove),
  };

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
                {formatMoney(a.taxableValue, 'INR')} +{' '}
                {a.gstRate !== null ? `GST ${Number(a.gstRate)}%` : 'GST at each line’s rate'}
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
              ` · ${a.status === 'rejected' ? 'rejected' : 'approved'} by ${a.decidedByName}${a.decisionNote ? ` (${a.decisionNote})` : ''}`}
          </div>
          {a.status === 'void' && (
            <div className="mt-0.5 text-xs text-ink-muted">
              {voidLine(a)}. The number stays used.
            </div>
          )}
          {a.kind === 'credit_note' && a.number && (a.status === 'approved' || a.status === 'void') && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void downloadFile(
                    `/billing/credit-notes/${a.id}/pdf`,
                    `${a.number!.replace(/\//g, '-')}.pdf`,
                  ).catch(() => toast('Could not download the PDF.', 'error'))
                }
              >
                <Download className="h-4 w-4" /> {a.status === 'void' ? 'PDF (void)' : 'PDF'}
              </Button>
              {mayVoidCreditNote(a, me, invoice.status) && voidingId !== a.id && (
                <Button size="sm" variant="ghost" onClick={() => setVoidingId(a.id)}>
                  <Ban className="h-4 w-4" /> Void
                </Button>
              )}
            </div>
          )}
          {voidingId === a.id && (
            <div className="mt-2 space-y-2 rounded-md bg-surface-sunken p-3">
              <p className="text-xs text-ink-muted">
                Voiding brings {formatMoney(a.total, 'INR')} back onto the invoice. The number{' '}
                {a.number} is not reused. Once the GSTR-1 for its month is filed, raise a debit
                note or amend it in the next return instead.
              </p>
              <Field label="Why is it void?">
                <Input
                  autoFocus
                  value={voidReason}
                  maxLength={500}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setVoidingId(null);
                    setVoidReason('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!voidReason.trim() || voidNote.isPending}
                  onClick={() => voidNote.mutate(a)}
                >
                  Void credit note
                </Button>
              </div>
            </div>
          )}
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
            {kind === 'write_off' && (
              <Field label="Amount">
                <Input
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            )}
          </div>
          {kind === 'credit_note' && (
            <div className="space-y-1.5">
              <p className="text-xs text-ink-muted">
                Credit each line before tax; its GST rate is added as on the invoice.
              </p>
              {invoice.lines.map((l) => {
                const left = Number(l.taxableValue) - Number(credited.get(l.id) ?? 0);
                return (
                  <div key={l.id} className="grid grid-cols-[1fr_auto_8rem] items-center gap-3">
                    <span className="truncate text-sm text-ink" title={l.description}>
                      {l.description}
                      <span className="block text-xs text-ink-faint">
                        GST {Number(l.gstRate)}% · {formatMoney(String(left.toFixed(2)), 'INR')}{' '}
                        left to credit
                      </span>
                    </span>
                    <span className="text-xs text-ink-faint tabular-nums">
                      of {formatMoney(l.taxableValue, 'INR')}
                    </span>
                    <Input
                      aria-label={`Credit on ${l.description}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      disabled={left <= 0}
                      value={lineAmounts[l.id] ?? ''}
                      onChange={(e) => setLineAmounts((m) => ({ ...m, [l.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <Field label="Why?" hint="The partner sees this when deciding.">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex items-center justify-end gap-3 text-sm">
            {touched &&
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
