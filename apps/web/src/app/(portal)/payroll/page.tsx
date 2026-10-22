'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import {
  PERMISSION,
  type BankChangeRequest,
  type PayKind,
  type PayrollRunSummary,
  type SalaryStructure,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  errorText,
  monthLabel,
  monthOf,
  useIsPayApprover,
  usePayAction,
} from '@/lib/payroll';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/** Monthly runs (spec §4.8): HR prepares, the Managing Partner approves, HR pays and releases. */
export default function PayrollPage(): JSX.Element {
  const { principal } = useAuth();
  const approver = useIsPayApprover();
  if (!can(principal, PERMISSION.payrollRead) && !approver) {
    return (
      <div>
        <PageHeader title="Payroll" />
        <EmptyState>Pay is visible only to HR, the Managing Partner and the named alternate.</EmptyState>
      </div>
    );
  }
  return <Payroll prepares={can(principal, PERMISSION.payrollPrepare)} approver={approver} />;
}

function Payroll({ prepares, approver }: { prepares: boolean; approver: boolean }): JSX.Element {
  const runs = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => apiFetch<PayrollRunSummary[]>('/payroll/runs'),
  });
  const waiting = (runs.data ?? []).filter((r) => r.status === 'submitted');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll"
        subtitle="Salaries and stipends, month by month. The portal never moves money: HR pays from the bank file and enters the bank's reference."
        actions={
          <Link href="/payroll/settings">
            <Button variant="secondary">
              <Settings2 className="h-4 w-4" /> Settings
            </Button>
          </Link>
        }
      />
      {approver && waiting.length > 0 && (
        <Card className="border-warning-600/40">
          <CardBody className="text-sm">
            <span className="font-semibold text-ink">Waiting for your approval: </span>
            {waiting.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <Link className="text-primary-700 hover:underline" href={`/payroll/runs/${r.id}`}>
                  {r.kind} {monthLabel(r.month)} ({formatMoney(r.net)} net, {r.people} people)
                </Link>
              </span>
            ))}
          </CardBody>
        </Card>
      )}
      <PendingStructures approver={approver} />
      {prepares && <NewRun />}
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {runs.isLoading ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : runs.error ? (
            <div className="p-5">
              <EmptyState>{errorText(runs.error)}</EmptyState>
            </div>
          ) : (runs.data ?? []).length === 0 ? (
            <div className="p-5">
              <EmptyState>No payroll run yet. Start with this month’s salaries.</EmptyState>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Register</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-5 py-2 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.data!.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-raised">
                    <td className="px-5 py-2">
                      <Link className="font-medium text-primary-700 hover:underline" href={`/payroll/runs/${r.id}`}>
                        {monthLabel(r.month)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 capitalize">{r.kind}</td>
                    <td className="px-3 py-2">
                      <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.people}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.net)}</td>
                    <td className="px-5 py-2 text-ink-muted">
                      {r.paidAt ? `${formatDate(r.paidAt)} · ${r.bankReference}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      {prepares && <BankChanges />}
    </div>
  );
}

function NewRun(): JSX.Element {
  const router = useRouter();
  const [month, setMonth] = useState(monthOf());
  const [kind, setKind] = useState<PayKind>('salary');
  const create = usePayAction(
    () => apiFetch<PayrollRunSummary>('/payroll/runs', { method: 'POST', body: { month, kind } }),
    (r) => `${r.kind === 'stipend' ? 'Stipend' : 'Salary'} run for ${monthLabel(r.month)} created.`,
  );
  return (
    <Card>
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined, {
              onSuccess: (r) => router.push(`/payroll/runs/${r.id}`),
            });
          }}
        >
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
          <Field label="Register">
            <Select value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>
              <option value="salary">Salaries</option>
              <option value="stipend">Articles’ stipends</option>
            </Select>
          </Field>
          <Button type="submit" disabled={!month || create.isPending}>
            Start a run
          </Button>
          <p className="text-xs text-ink-faint">
            Enter loss-of-pay days and one-off amounts on the run, then compute it.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

function PendingStructures({ approver }: { approver: boolean }): JSX.Element | null {
  const list = useQuery({
    queryKey: ['payroll', 'structures', 'proposed'],
    queryFn: () => apiFetch<SalaryStructure[]>('/payroll/structures?status=proposed'),
  });
  const rows = list.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay {approver ? 'waiting for your approval' : 'proposed, waiting for approval'}</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="space-y-1 text-sm">
          {rows.map((s) => (
            <li key={s.id}>
              <Link className="text-primary-700 hover:underline" href={`/payroll/structures?open=${s.employeeId}`}>
                {s.fullName ?? s.employeeId}
              </Link>{' '}
              — {s.kind} from {formatDate(s.effectiveFrom)},{' '}
              {formatMoney(s.components.reduce((t, c) => t + Number(c.monthly), 0))} a month
              {s.belowStipendMinimum && (
                <Badge tone="danger" className="ml-2">
                  Below the ICAI minimum
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Bank-change requests: verify with the person (on their old details) before the next run. */
function BankChanges(): JSX.Element | null {
  const list = useQuery({
    queryKey: ['payroll', 'bank-changes', 'requested'],
    queryFn: () => apiFetch<BankChangeRequest[]>('/payroll/bank-changes?status=requested'),
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const decide = usePayAction(
    ({ id, decision }: { id: string; decision: 'verify' | 'reject' }) =>
      apiFetch<BankChangeRequest>(`/payroll/bank-changes/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(reason[id]?.trim() ? { reason: reason[id]!.trim() } : {}) },
      }),
    (r) => (r.status === 'verified' ? 'Verified — the next run pays into the new account.' : 'Rejected.'),
  );
  const rows = list.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank changes to verify</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-ink-muted">
          Redirecting salary is the commonest payroll fraud. Call the person on the number already on file
          before you verify; you cannot verify a change to your own account.
        </p>
        {rows.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
            <span className="font-medium text-ink">{b.displayName}</span>
            <span className="text-ink-muted">
              {b.accountHolder} · {b.accountMasked} · {b.ifsc} · asked {formatDate(b.requestedAt)}
            </span>
            <Input
              className="ml-auto max-w-xs"
              placeholder="Reason (needed to reject)"
              value={reason[b.id] ?? ''}
              onChange={(e) => setReason((r) => ({ ...r, [b.id]: e.target.value }))}
            />
            <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: b.id, decision: 'verify' })}>
              Verify
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={decide.isPending || !reason[b.id]?.trim()}
              onClick={() => decide.mutate({ id: b.id, decision: 'reject' })}
            >
              Reject
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
