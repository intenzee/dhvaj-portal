'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import {
  FEE_PERIODS,
  FEE_PERIOD_UNIT,
  PERMISSION,
  feeWithPeriod,
  rupees,
  type ClientFeeRow,
  type ClientFees,
  type FeePeriod,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';

/**
 * CM-4 · Client 360's Fees card: each open engagement's fee for the current
 * year, the period it is for, how often it is invoiced, its year's value and
 * what is unbilled. fee.agree edits the amount and period in the row; roles
 * with neither engagement.read_commercial nor fee.agree do not see the card.
 */
export function FeesCard({ entityId }: { entityId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const allowed =
    can(principal, PERMISSION.engagementReadCommercial) || can(principal, PERMISSION.feeAgree);
  const fees = useQuery({
    queryKey: ['entity', entityId, 'fees'],
    queryFn: () => apiFetch<ClientFees>(`/entities/${entityId}/fees`),
    enabled: allowed,
  });
  if (!allowed) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fees{fees.data ? ` · FY ${fees.data.financialYear}` : ''}</CardTitle>
      </CardHeader>
      <CardBody className="overflow-x-auto">
        {fees.isLoading && <Spinner label="Loading fees…" />}
        {fees.isError && (
          <p className="text-sm text-danger-700">
            {fees.error instanceof ApiError ? fees.error.message : 'Could not load the fees.'}
          </p>
        )}
        {fees.data && fees.data.rows.length === 0 && (
          <p className="text-sm text-ink-faint">No open engagement has a year in scope for this FY.</p>
        )}
        {fees.data && fees.data.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="py-1 pr-4">Service</th>
                <th className="py-1 pr-4">FY</th>
                <th className="py-1 pr-4">Fee</th>
                <th className="py-1 pr-4">Invoiced</th>
                <th className="py-1 pr-4">Year value</th>
                <th className="py-1 pr-4">Unbilled</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {fees.data.rows.map((r) => (
                <FeeRow key={r.engagementId} entityId={entityId} row={r} canEdit={fees.data.canEdit} />
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function FeeRow({
  entityId,
  row,
  canEdit,
}: {
  entityId: string;
  row: ClientFeeRow;
  canEdit: boolean;
}): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(row.feeAmount ? String(Number(row.feeAmount)) : '');
  const [period, setPeriod] = useState<FeePeriod>(row.feePeriod);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${row.engagementId}/years/${row.financialYear}`, {
        method: 'PATCH',
        body: {
          feeAmount: amount.trim() === '' ? null : Number(amount),
          feePeriod: period,
          version: row.yearVersion,
        },
      }),
    onSuccess: () => {
      toast('Fee saved.', 'success');
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['entity', entityId, 'fees'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save the fee.', 'error'),
  });

  const bad = amount.trim() !== '' && (Number.isNaN(Number(amount)) || Number(amount) < 0);

  return (
    <tr className="border-t border-line/60 align-top">
      <td className="py-1.5 pr-4">
        <Link href={`/engagements/${row.engagementId}`} className="font-medium text-ink hover:underline">
          {row.serviceName}
        </Link>
        <div className="text-xs text-ink-faint">{row.engagementCode}</div>
      </td>
      <td className="py-1.5 pr-4">{row.financialYear}</td>
      <td className="py-1.5 pr-4">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <span className="text-ink-muted">₹</span>
            <Input
              aria-label="Fee amount"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
            <Select
              aria-label="Fee period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as FeePeriod)}
              className="w-28"
            >
              {FEE_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p === 'one_time' ? FEE_PERIOD_UNIT[p] : `per ${FEE_PERIOD_UNIT[p]}`}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <>
            {feeWithPeriod(row.feeAmount, row.feePeriod)}
            {row.feeAmount && !row.feePeriodSetAt && (
              <Badge tone="warn" className="ml-1.5">
                Period not confirmed
              </Badge>
            )}
          </>
        )}
      </td>
      <td className="py-1.5 pr-4 text-ink-muted">
        {row.billingFrequency ? humanize(row.billingFrequency) : 'Not set up'}
      </td>
      <td className="py-1.5 pr-4">{row.annualFee ? rupees(row.annualFee) : '—'}</td>
      <td className="py-1.5 pr-4">{row.unbilled ? rupees(row.unbilled) : '—'}</td>
      <td className="py-1.5 text-right">
        {canEdit &&
          (editing ? (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || bad}>
                Save
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit fee">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ))}
      </td>
    </tr>
  );
}
