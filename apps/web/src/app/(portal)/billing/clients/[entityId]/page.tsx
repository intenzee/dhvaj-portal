'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Undo2 } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ClientStatement,
  type ReceiptRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { Field, Input } from '@/components/form';
import { RecordReceiptModal } from '@/components/billing/record-receipt-modal';
import { statementKindLabel } from '@/components/billing/receipts';

/**
 * PS-202 · a client's account with the firm: invoices, receipts, TDS, approved
 * credit notes and write-offs (PS-205) and the balance.
 */
export default function ClientStatementPage(): JSX.Element {
  const { entityId } = useParams<{ entityId: string }>();
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  const [recording, setRecording] = useState(false);

  const statement = useQuery({
    queryKey: ['billing', 'statement', entityId],
    queryFn: () => apiFetch<ClientStatement>(`/billing/clients/${entityId}/statement`),
    enabled: isOn(FEATURE_FLAG.billing),
  });

  if (!isOn(FEATURE_FLAG.billing)) {
    return <EmptyState>Client statements arrive with the new billing.</EmptyState>;
  }
  if (statement.isLoading) return <Spinner />;
  if (statement.error || !statement.data) {
    return (
      <EmptyState>
        {statement.error instanceof ApiError
          ? statement.error.message
          : 'Could not load the statement.'}
      </EmptyState>
    );
  }
  const s = statement.data;
  const owes = Number(s.totals.balance);

  return (
    <div>
      <PageHeader
        title={s.entityName}
        subtitle="Statement of account: every issued invoice, what was received, the TDS deducted and any approved credit."
        back={{ href: '/billing', label: 'Billing & Collections' }}
        actions={
          can(principal, PERMISSION.billingManage) ? (
            <Button onClick={() => setRecording(true)}>
              <Plus className="h-4 w-4" /> Record receipt
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Invoiced" value={s.totals.invoiced} />
        <Tile label="Received" value={s.totals.received} />
        <Tile label="TDS deducted" value={s.totals.tds} />
        <Tile label="Credited" value={s.totals.credited} />
        <Tile
          label={owes < 0 ? 'In credit' : 'Balance due'}
          value={String(Math.abs(owes))}
          tone={owes > 0 ? 'warn' : 'ok'}
        />
        <Tile label="Advance held" value={s.totals.advance} />
      </div>

      {s.tdsReceivable.length > 0 && (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>TDS receivable</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-2 text-xs text-ink-faint">
              Deducted by the client on our fees; claim it against 26AS for the quarter.
            </p>
            <div className="flex flex-wrap gap-2">
              {s.tdsReceivable.map((q) => (
                <span
                  key={`${q.financialYear}-${q.quarter}`}
                  className="rounded-md border border-line px-3 py-1.5 text-sm"
                >
                  FY {q.financialYear} {q.quarter}
                  <span className="ml-2 font-medium tabular-nums text-ink">
                    {formatMoney(q.amount, 'INR')}
                  </span>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card className="mt-3 p-0">
        <CardHeader>
          <CardTitle>Statement</CardTitle>
        </CardHeader>
        {s.lines.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-faint">No issued invoices or receipts yet.</p>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Entry</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-ink-muted">{formatDate(l.date)}</td>
                  <td className="px-4 py-2">{statementKindLabel(l.kind)}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-muted">{l.reference ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {Number(l.debit) ? formatMoney(l.debit, 'INR') : ''}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {Number(l.credit) ? formatMoney(l.credit, 'INR') : ''}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatMoney(l.balance, 'INR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
        </CardHeader>
        <CardBody>
          {s.receipts.length === 0 ? (
            <p className="text-sm text-ink-faint">None recorded.</p>
          ) : (
            <div className="space-y-2">
              {[...s.receipts].reverse().map((r) => (
                <ReceiptRow key={r.id} r={r} entityId={entityId} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {recording && (
        <RecordReceiptModal
          open
          onClose={() => setRecording(false)}
          entity={{ id: s.entityId, name: s.entityName }}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'ok';
}): JSX.Element {
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div
        className={cn(
          'mt-1 text-xl font-bold tabular-nums',
          tone === 'warn' ? 'text-warning-700' : tone === 'ok' ? 'text-success-700' : 'text-ink',
        )}
      >
        {formatMoney(value, 'INR')}
      </div>
    </div>
  );
}

function ReceiptRow({ r, entityId }: { r: ReceiptRecord; entityId: string }): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const reverse = useMutation({
    mutationFn: () =>
      apiFetch<ReceiptRecord>(`/billing/receipts/${r.id}/reverse`, {
        method: 'POST',
        body: { reason: reason.trim(), version: r.version },
      }),
    onSuccess: () => {
      toast('Receipt reversed; its invoices are open again.');
      void qc.invalidateQueries({ queryKey: ['billing', 'statement', entityId] });
      void qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not reverse it.', 'error'),
  });

  return (
    <div className="rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-ink">{formatDate(r.receivedOn)}</span>
        <span className="text-ink-muted">
          {r.mode === 'upi' ? 'UPI' : humanize(r.mode)}
          {r.reference ? ` · ${r.reference}` : ''}
        </span>
        <span className="tabular-nums">
          Net {formatMoney(r.netAmount, 'INR')}
          {Number(r.tdsAmount) > 0 &&
            ` + TDS ${formatMoney(r.tdsAmount, 'INR')} (${r.tdsSection === 'other' ? 'other' : `s.${r.tdsSection}`})`}
        </span>
        {r.status === 'reversed' ? (
          <Badge tone="danger">Reversed</Badge>
        ) : (
          Number(r.unallocated) > 0 && (
            <Badge tone="info">Advance {formatMoney(r.unallocated, 'INR')}</Badge>
          )
        )}
        {r.status === 'posted' && can(principal, PERMISSION.billingApprove) && !reversing && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setReversing(true)}>
            <Undo2 className="h-4 w-4" /> Reverse
          </Button>
        )}
      </div>
      {r.allocations.length > 0 && (
        <div className="mt-1 text-xs text-ink-faint">
          Paid{' '}
          {r.allocations
            .map((a) => `${a.invoiceNumber ?? 'invoice'} ${formatMoney(a.amount, 'INR')}`)
            .join(', ')}
        </div>
      )}
      {r.status === 'reversed' && r.reversedReason && (
        <div className="mt-1 text-xs text-ink-muted">Reversed: {r.reversedReason}</div>
      )}
      {reversing && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Field
              label="Why reverse it?"
              hint="A bounced cheque, a wrong client… The invoices reopen."
            >
              <Input
                autoFocus
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setReversing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => reverse.mutate()}
            disabled={!reason.trim() || reverse.isPending}
          >
            Reverse receipt
          </Button>
        </div>
      )}
    </div>
  );
}
