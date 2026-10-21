'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PayrollJournal, PayrollRunTotals, StatutoryKind, StatutoryWorking } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, usePayAction } from '@/lib/payroll';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { Input } from '@/components/form';

const KIND_LABEL: Record<StatutoryKind, string> = {
  pf: 'Provident Fund (ECR)',
  esi: 'ESI',
  pt: 'Professional tax',
  tds: 'Income tax (TDS on salary)',
};

/**
 * PF, ESI, PT and TDS for a month from the approved runs: what is due, by
 * when, and the challan once deposited. `canRecord`: the Accountant or the
 * Managing Partner.
 */
export function StatutoryTable({ month, canRecord }: { month: string; canRecord: boolean }): JSX.Element {
  const [open, setOpen] = useState<StatutoryKind | null>(null);
  const list = useQuery({
    queryKey: ['payroll', 'statutory', month],
    queryFn: () => apiFetch<StatutoryWorking[]>(`/payroll/statutory/${month}`),
    retry: false,
  });
  if (list.isLoading) return <Spinner />;
  if (list.error) return <EmptyState>{errorText(list.error)}</EmptyState>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line text-left text-xs text-ink-muted">
        <tr>
          <th className="px-5 py-2 font-medium">Head</th>
          <th className="px-3 py-2 text-right font-medium">People</th>
          <th className="px-3 py-2 text-right font-medium">Employees</th>
          <th className="px-3 py-2 text-right font-medium">Firm</th>
          <th className="px-3 py-2 text-right font-medium">To deposit</th>
          <th className="px-3 py-2 font-medium">Due</th>
          <th className="px-5 py-2 font-medium">Challan</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {(list.data ?? []).map((s) => {
          const overdue = !s.paidOn && Number(s.total) > 0 && s.dueOn < today;
          return (
            <tr key={s.kind} className="align-top">
              <td className="px-5 py-2 font-medium text-ink">{KIND_LABEL[s.kind]}</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.people}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.employee)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.employer)}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(s.total)}</td>
              <td className="px-3 py-2">
                {formatDate(s.dueOn)} {overdue && <Badge tone="danger">Overdue</Badge>}
              </td>
              <td className="px-5 py-2">
                {s.challanNumber ? (
                  <span>
                    {s.challanNumber} · paid {formatDate(s.paidOn)}
                    {s.paidBy && <span className="text-ink-faint"> by {s.paidBy}</span>}
                  </span>
                ) : Number(s.total) === 0 ? (
                  <span className="text-ink-faint">Nothing due</span>
                ) : (
                  <span className="text-ink-muted">Not yet deposited</span>
                )}
                {canRecord && Number(s.total) > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2"
                    onClick={() => setOpen(open === s.kind ? null : s.kind)}
                  >
                    {s.challanNumber ? 'Correct' : 'Record challan'}
                  </Button>
                )}
                {open === s.kind && (
                  <ChallanForm working={s} onDone={() => setOpen(null)} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChallanForm({ working, onDone }: { working: StatutoryWorking; onDone: () => void }): JSX.Element {
  const [challanNumber, setNumber] = useState(working.challanNumber ?? '');
  const [paidOn, setPaidOn] = useState(working.paidOn ?? new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(working.total);
  const save = usePayAction(
    () =>
      apiFetch<StatutoryWorking[]>(`/payroll/statutory/${working.month}/${working.kind}`, {
        method: 'PUT',
        body: { challanNumber: challanNumber.trim(), paidOn, amount: amount.trim() },
      }),
    'Challan recorded.',
  );
  const valid = challanNumber.trim() && paidOn && /^\d{1,12}(\.\d{1,2})?$/.test(amount.trim());
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input className="w-40" placeholder="Challan / CIN" value={challanNumber} onChange={(e) => setNumber(e.target.value)} />
      <Input className="w-40" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      <Input className="w-32 text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
        Save
      </Button>
      {Number(amount) !== Number(working.total) && amount.trim() && (
        <span className="text-xs text-warning-700">Differs from the working ({formatMoney(working.total)}).</span>
      )}
    </div>
  );
}

/** Totals by head for one run — no person in them. */
export function TotalsBreakdown({ totals }: { totals: PayrollRunTotals }): JSX.Element {
  const col = (title: string, rows: { code: string; label: string; amount: string }[]) => (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-muted">{title}</p>
      {rows.length === 0 && <p className="text-ink-faint">—</p>}
      {rows.map((r) => (
        <p key={r.code} className="flex justify-between gap-4">
          <span>{r.label}</span>
          <span className="tabular-nums">{formatMoney(r.amount)}</span>
        </p>
      ))}
    </div>
  );
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-3">
      {col('Earnings', totals.earnings)}
      {col('Deductions', totals.deductions)}
      {col('The firm’s contributions', totals.employer)}
    </div>
  );
}

/** The balanced entry to book the run. */
export function JournalCard({ runId }: { runId: string }): JSX.Element {
  const journal = useQuery({
    queryKey: ['payroll', 'journal', runId],
    queryFn: () => apiFetch<PayrollJournal>(`/payroll/runs/${runId}/journal`),
    retry: false,
  });
  if (journal.isLoading) return <Spinner />;
  if (journal.error || !journal.data) return <EmptyState>{errorText(journal.error)}</EmptyState>;
  const j = journal.data;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line text-left text-xs text-ink-muted">
        <tr>
          <th className="py-1 font-medium">Account</th>
          <th className="py-1 text-right font-medium">Debit</th>
          <th className="py-1 text-right font-medium">Credit</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {j.entries.map((e) => (
          <tr key={e.account}>
            <td className="py-1">{e.account}</td>
            <td className="py-1 text-right tabular-nums">{Number(e.debit) ? formatMoney(e.debit) : ''}</td>
            <td className="py-1 text-right tabular-nums">{Number(e.credit) ? formatMoney(e.credit) : ''}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="py-1">Total</td>
          <td className="py-1 text-right tabular-nums">{formatMoney(j.totalDebit)}</td>
          <td className="py-1 text-right tabular-nums">{formatMoney(j.totalCredit)}</td>
        </tr>
      </tbody>
    </table>
  );
}
