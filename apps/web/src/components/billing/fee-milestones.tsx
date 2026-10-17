'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEE_MILESTONE_KINDS,
  PERMISSION,
  type CreateFeeMilestoneInput,
  type FeeMilestone,
  type FeeMilestoneKind,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { Modal } from '@/components/modal';
import { MILESTONE_STATUS, milestoneInputError } from './fee-milestones-model';

/**
 * PS-206 · fees agreed on a milestone or an event rather than the calendar.
 * Each joins Billing → Unbilled fees on its date; billed, it shows its invoice.
 */
export function FeeMilestones({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const key = ['billing', 'fee-milestones', engagementId] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<FeeMilestone[]>(`/billing/engagements/${engagementId}/fee-milestones`),
  });
  const mayManage = can(principal, PERMISSION.billingManage);

  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiFetch<FeeMilestone>(`/billing/fee-milestones/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast('Fee milestone cancelled.');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not cancel it.', 'error'),
  });

  const rows = (list.data ?? []).filter((m) => m.status !== 'cancelled');
  if (!mayManage && rows.length === 0) return null;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Milestone and event fees</h2>
          <p className="text-xs text-ink-faint">
            Due on their date, they join{' '}
            <Link href="/billing/unbilled" className="text-primary-700 hover:underline">
              Unbilled fees
            </Link>
            .
          </p>
        </div>
        {mayManage && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add fee
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-faint">None agreed.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1">
                {m.description}
                <span className="block text-xs text-ink-faint">
                  {m.kind === 'event' ? 'Event' : 'Milestone'} · from {formatDate(m.dueOn)}
                </span>
              </span>
              <span className="tabular-nums">{formatMoney(m.amount, 'INR')}</span>
              <Badge tone={MILESTONE_STATUS[m.status].tone}>
                {MILESTONE_STATUS[m.status].label}
              </Badge>
              {mayManage && m.status !== 'billed' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(m.id)}
                >
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddFeeMilestone engagementId={engagementId} open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

function AddFeeMilestone({
  engagementId,
  open,
  onClose,
}: {
  engagementId: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<FeeMilestoneKind>('milestone');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const input: CreateFeeMilestoneInput = { kind, description, amount: amount.trim(), dueOn };
  const error = milestoneInputError(input);

  const add = useMutation({
    mutationFn: () =>
      apiFetch<FeeMilestone>(`/billing/engagements/${engagementId}/fee-milestones`, {
        method: 'POST',
        body: { ...input, description: description.trim() },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast('Fee added.');
      setDescription('');
      setAmount('');
      setDueOn('');
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add the fee.', 'error'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a milestone or event fee"
      description="Billed once, from the date it falls due."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Boolean(error) || add.isPending} onClick={() => add.mutate()}>
            Add fee
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as FeeMilestoneKind)}>
            {FEE_MILESTONE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'event' ? 'Event' : 'Milestone'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What for" required>
          <Input
            value={description}
            placeholder="e.g. Valuation report delivered"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" required>
            <Input
              inputMode="decimal"
              placeholder="75000.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Billable from" required>
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        </div>
        {error && (description || amount || dueOn) && (
          <p className="text-xs text-danger-700">{error}</p>
        )}
      </div>
    </Modal>
  );
}
