'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import {
  IFSC_PATTERN,
  type BankChangeRequest,
  type EmployeePayDetails,
  type Payslip,
  type PayslipSummary,
  type SalaryStructure,
} from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, monthLabel, usePayAction } from '@/lib/payroll';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { LineDetail } from '@/components/payroll/line-detail';

interface OwnPay {
  structures: SalaryStructure[];
  payDetails: EmployeePayDetails;
  bankChanges: BankChangeRequest[];
}

const CHANGE_TONE: Record<string, string> = { requested: 'warn', verified: 'success', rejected: 'danger' };

/** A person's own pay: payslips once released, the pay in force, and the salary account. */
export default function MyPayPage(): JSX.Element {
  const own = useQuery({
    queryKey: ['me', 'pay'],
    queryFn: () => apiFetch<OwnPay>('/me/pay'),
    retry: false,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="My pay"
        subtitle="Only you, HR and the Managing Partner see this. Payslips appear once the month is paid and released."
        actions={
          <Link href="/me/tax">
            <Button variant="secondary">My income tax and Form 130</Button>
          </Link>
        }
      />
      <Payslips />
      {own.isLoading ? (
        <Spinner />
      ) : own.error || !own.data ? (
        <EmptyState>{errorText(own.error)}</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Structure rows={own.data.structures} />
          <Bank details={own.data.payDetails} changes={own.data.bankChanges} />
        </div>
      )}
    </div>
  );
}

function Payslips(): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['me', 'pay', 'payslips'],
    queryFn: () => apiFetch<PayslipSummary[]>('/me/pay/payslips'),
    retry: false,
  });
  const rows = list.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payslips</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {list.isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState>No payslip yet.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {rows.map((p) => {
              const isOpen = open === p.runId;
              return (
                <li key={p.runId} className="px-5 py-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="group flex flex-1 items-center gap-3 text-left"
                      onClick={() => setOpen(isOpen ? null : p.runId)}
                    >
                      <ExpandToggle open={isOpen} />
                      <span className="font-medium text-ink">{monthLabel(p.month)}</span>
                      <span className="capitalize text-ink-faint">{p.kind}</span>
                      <span className="ml-auto tabular-nums">{formatMoney(p.net)} net</span>
                      <span className="w-28 text-right text-ink-muted">{p.paidAt ? formatDate(p.paidAt) : ''}</span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void downloadFile(`/me/pay/payslips/${p.runId}/pdf`, `payslip-${p.month}.pdf`).catch((err) =>
                          toast(errorText(err), 'error'),
                        )
                      }
                    >
                      <FileText className="h-3.5 w-3.5" /> PDF
                    </Button>
                  </div>
                  {isOpen && <PayslipDetail runId={p.runId} />}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function PayslipDetail({ runId }: { runId: string }): JSX.Element {
  const slip = useQuery({
    queryKey: ['me', 'pay', 'payslips', runId],
    queryFn: () => apiFetch<Payslip>(`/me/pay/payslips/${runId}`),
    retry: false,
  });
  if (slip.isLoading) return <Spinner />;
  if (slip.error || !slip.data) return <EmptyState>{errorText(slip.error)}</EmptyState>;
  const l = slip.data.line;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface-sunken/40 p-3">
      <p className="text-xs text-ink-muted">
        {l.payableDays} of {l.daysInMonth} days paid · gross {formatMoney(l.gross)} · deductions{' '}
        {formatMoney(l.deductions)} · net {formatMoney(l.net)}
        {slip.data.bankReference && ` · bank reference ${slip.data.bankReference}`}
      </p>
      <LineDetail line={l} />
    </div>
  );
}

function Structure({ rows }: { rows: SalaryStructure[] }): JSX.Element {
  const current = rows[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>My pay</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2 text-sm">
        {!current ? (
          <EmptyState>No pay is set yet.</EmptyState>
        ) : (
          <>
            <p className="text-ink-muted">
              <span className="capitalize">{current.kind}</span> from {formatDate(current.effectiveFrom)}
            </p>
            {current.components.map((c) => (
              <p key={c.code} className="flex justify-between">
                <span>{c.label}</span>
                <span className="tabular-nums">{formatMoney(c.monthly)}</span>
              </p>
            ))}
            <p className="flex justify-between border-t border-line pt-1 font-semibold">
              <span>A month</span>
              <span className="tabular-nums">
                {formatMoney(current.components.reduce((t, c) => t + Number(c.monthly), 0))}
              </span>
            </p>
            {rows.length > 1 && (
              <p className="text-xs text-ink-faint">
                Earlier: {rows.slice(1).map((s) => `from ${formatDate(s.effectiveFrom)}`).join(', ')}
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Bank({ details, changes }: { details: EmployeePayDetails; changes: BankChangeRequest[] }): JSX.Element {
  const [changing, setChanging] = useState(false);
  const pending = changes.some((c) => c.status === 'requested');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Salary account</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2 text-sm">
        {details.accountMasked ? (
          <p>
            {details.accountHolder} · {details.accountMasked} · {details.ifsc}
            {details.bankName && ` · ${details.bankName}`}
          </p>
        ) : (
          <p className="text-ink-muted">HR has not recorded your account yet.</p>
        )}
        {details.panMasked && <p className="text-ink-muted">PAN {details.panMasked}</p>}
        {details.uan && <p className="text-ink-muted">UAN {details.uan}</p>}
        {!pending && (
          <Button size="sm" variant="secondary" onClick={() => setChanging((v) => !v)}>
            Change my account
          </Button>
        )}
        {changing && <BankChangeForm onDone={() => setChanging(false)} />}
        {changes.length > 0 && (
          <ul className="space-y-1 border-t border-line pt-2">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={CHANGE_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                <span>
                  {c.accountMasked} · {c.ifsc} · asked {formatDate(c.requestedAt)}
                </span>
                {c.reason && <span className="text-ink-muted">— {c.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function BankChangeForm({ onDone }: { onDone: () => void }): JSX.Element {
  const [accountHolder, setHolder] = useState('');
  const [accountNumber, setNumber] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const request = usePayAction(
    () =>
      apiFetch<BankChangeRequest>('/me/pay/bank-change', {
        method: 'POST',
        body: {
          accountHolder: accountHolder.trim(),
          accountNumber: accountNumber.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
        },
      }),
    'Sent to HR. They will call you on the number on file before switching.',
  );
  const valid =
    accountHolder.trim() &&
    /^[0-9A-Za-z]{6,20}$/.test(accountNumber.trim()) &&
    accountNumber.trim() === confirm.trim() &&
    IFSC_PATTERN.test(ifsc.trim().toUpperCase());
  return (
    <form
      className="space-y-2 rounded-lg border border-line bg-surface-sunken/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        request.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <Field label="Account holder">
        <Input value={accountHolder} onChange={(e) => setHolder(e.target.value)} />
      </Field>
      <Field label="Account number">
        <Input autoComplete="off" value={accountNumber} onChange={(e) => setNumber(e.target.value)} />
      </Field>
      <Field label="Account number again">
        <Input autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Field label="IFSC">
        <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
      </Field>
      <Field label="Bank (optional)">
        <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" disabled={!valid || request.isPending}>
        Ask HR to switch
      </Button>
    </form>
  );
}
