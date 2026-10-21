'use client';

import { Fragment, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet, FileText } from 'lucide-react';
import {
  PAYROLL_INPUT_KINDS,
  PERMISSION,
  type PayRosterRow,
  type PayrollInputKind,
  type PayrollMonthInputs,
  type PayrollRunDetail,
  type PayrollRunSummary,
} from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  errorText,
  monthLabel,
  useIsPayApprover,
  usePayAction,
} from '@/lib/payroll';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { LineDetail } from '@/components/payroll/line-detail';

export default function PayrollRunPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const run = useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: () => apiFetch<PayrollRunDetail>(`/payroll/runs/${id}`),
    retry: false,
  });
  if (run.isLoading) return <Spinner />;
  if (run.error || !run.data) {
    return (
      <div>
        <PageHeader title="Payroll run" back={{ href: '/payroll', label: 'Payroll' }} />
        <EmptyState>{errorText(run.error)}</EmptyState>
      </div>
    );
  }
  return <Run run={run.data} />;
}

function Run({ run }: { run: PayrollRunDetail }): JSX.Element {
  const { principal } = useAuth();
  const prepares = can(principal, PERMISSION.payrollPrepare);
  const approver = useIsPayApprover();
  const editable = run.status === 'draft' || run.status === 'computed';
  const title = `${run.kind === 'stipend' ? 'Stipends' : 'Salaries'} — ${monthLabel(run.month)}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        subtitle={[
          run.preparedBy && `Prepared by ${run.preparedBy}`,
          run.approvedBy && `approved by ${run.approvedBy} on ${formatDate(run.approvedAt)}`,
          run.paidAt && `paid ${formatDate(run.paidAt)} (${run.bankReference})`,
          run.payslipsReleasedAt && `payslips released ${formatDate(run.payslipsReleasedAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        back={{ href: '/payroll', label: 'Payroll' }}
        actions={<Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>}
      />
      {run.returnedReason && run.status === 'computed' && (
        <Card className="border-warning-600/40">
          <CardBody className="text-sm">
            <span className="font-semibold">Sent back: </span>
            {run.returnedReason}
          </CardBody>
        </Card>
      )}
      <Actions run={run} prepares={prepares} approver={approver} />
      <div className="grid gap-3 sm:grid-cols-5">
        {(
          [
            ['People', String(run.people)],
            ['Gross', formatMoney(run.gross)],
            ['Deductions', formatMoney(run.deductions)],
            ['Net pay', formatMoney(run.net)],
            ['Cost to the firm', formatMoney(run.employerCost)],
          ] as const
        ).map(([k, v]) => (
          <Card key={k}>
            <CardBody>
              <p className="text-xs text-ink-muted">{k}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{v}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      {run.warnings.length > 0 && (
        <Card>
          <CardBody className="space-y-1 text-sm">
            {run.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-warning-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
              </p>
            ))}
          </CardBody>
        </Card>
      )}
      {run.status !== 'draft' && <Changes run={run} />}
      {editable && prepares && <Inputs month={run.month} />}
      <Lines run={run} />
    </div>
  );
}

function Actions({
  run,
  prepares,
  approver,
}: {
  run: PayrollRunDetail;
  prepares: boolean;
  approver: boolean;
}): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const post = (step: string, body: Record<string, unknown> = {}) =>
    apiFetch<PayrollRunSummary>(`/payroll/runs/${run.id}/${step}`, {
      method: 'POST',
      body: { version: run.version, ...body },
    });
  const compute = usePayAction(() => post('compute'), 'Computed.');
  const submit = usePayAction(() => post('submit'), 'Submitted for approval.');
  const approve = usePayAction(() => post('approve'), 'Approved. HR can now download the bank file.');
  const sendBack = usePayAction(() => post('return', { reason: reason.trim() }), 'Sent back to HR.');
  const paid = usePayAction(() => post('paid', { bankReference: reference.trim() }), 'Marked paid.');
  const release = usePayAction(() => post('release'), 'Payslips released to each person.');
  const lock = usePayAction(() => post('lock'), 'Locked.');
  const remove = usePayAction(
    () => apiFetch<void>(`/payroll/runs/${run.id}`, { method: 'DELETE' }),
    'Run deleted.',
  );
  const download = (path: string, name: string) =>
    downloadFile(path, name).catch((err) => toast(errorText(err), 'error'));
  const busy = [compute, submit, approve, sendBack, paid, release, lock, remove].some((m) => m.isPending);

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-2">
        {prepares && (run.status === 'draft' || run.status === 'computed') && (
          <>
            <Button disabled={busy} onClick={() => compute.mutate(undefined)}>
              {run.status === 'draft' ? 'Compute' : 'Recompute'}
            </Button>
            {run.status === 'computed' && (
              <Button variant="secondary" disabled={busy || run.people === 0} onClick={() => submit.mutate(undefined)}>
                Submit for approval
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Delete this run and its lines?')) {
                  remove.mutate(undefined, { onSuccess: () => router.push('/payroll') });
                }
              }}
            >
              Delete
            </Button>
          </>
        )}
        {run.status === 'submitted' && approver && (
          <>
            <Button disabled={busy} onClick={() => approve.mutate(undefined)}>
              Approve
            </Button>
            <Input
              className="max-w-sm"
              placeholder="Why it goes back (needed to return)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => sendBack.mutate(undefined)}>
              Send back
            </Button>
          </>
        )}
        {run.status === 'submitted' && !approver && (
          <p className="text-sm text-ink-muted">Waiting for the Managing Partner (or the named alternate) to approve.</p>
        )}
        {prepares && (run.status === 'approved' || run.status === 'paid') && (
          <Button
            variant="secondary"
            onClick={() => void download(`/payroll/runs/${run.id}/bank-file`, 'bank-file.csv')}
          >
            <Download className="h-4 w-4" /> Bank file
          </Button>
        )}
        {prepares && run.status === 'approved' && (
          <>
            <Input
              className="max-w-xs"
              placeholder="Bank reference of the transfer"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Button disabled={busy || !reference.trim()} onClick={() => paid.mutate(undefined)}>
              Mark paid
            </Button>
          </>
        )}
        {prepares && run.status === 'paid' && !run.payslipsReleasedAt && (
          <Button disabled={busy} onClick={() => release.mutate(undefined)}>
            Release payslips
          </Button>
        )}
        {prepares && run.status === 'paid' && run.payslipsReleasedAt && (
          <Button variant="secondary" disabled={busy} onClick={() => lock.mutate(undefined)}>
            Lock
          </Button>
        )}
        {run.status !== 'draft' && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => void download(`/payroll/runs/${run.id}/register.xlsx`, 'register.xlsx')}
          >
            <FileSpreadsheet className="h-4 w-4" /> Register
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function Changes({ run }: { run: PayrollRunDetail }): JSX.Element {
  const c = run.changes;
  const rows: [string, string[]][] = [
    ['Joined', c.joiners],
    ['Left', c.leavers],
    ['Pay revised', c.revisions],
    ['Loss of pay', c.lossOfPay],
    ['Bank account changed', c.bankChanged],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Changes from last month</CardTitle>
      </CardHeader>
      <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, names]) => (
          <p key={label}>
            <span className={label === 'Bank account changed' && names.length > 0 ? 'font-semibold text-danger-700' : 'text-ink-muted'}>
              {label}:
            </span>{' '}
            {names.length ? names.join(', ') : '—'}
          </p>
        ))}
        <p>
          <span className="text-ink-muted">Net pay change:</span>{' '}
          <span className="tabular-nums">{formatMoney(c.netChange)}</span>
        </p>
      </CardBody>
    </Card>
  );
}

/** HR's month: loss-of-pay days and one-off amounts, per person. */
function Inputs({ month }: { month: string }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const roster = useQuery({
    queryKey: ['payroll', 'roster'],
    queryFn: () => apiFetch<PayRosterRow[]>('/payroll/roster'),
  });
  const inputs = useQuery({
    queryKey: ['payroll', 'inputs', month],
    queryFn: () => apiFetch<PayrollMonthInputs[]>(`/payroll/inputs/${month}`),
  });
  const people = (roster.data ?? []).filter((p) => p.current);
  const of = (id: string) => (inputs.data ?? []).find((i) => i.employeeId === id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>This month’s inputs</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {roster.isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {people.map((p) => {
              const mine = of(p.employeeId);
              const isOpen = open === p.employeeId;
              return (
                <li key={p.employeeId} className="px-5 py-2">
                  <button
                    type="button"
                    className="group flex w-full items-center gap-3 text-left"
                    onClick={() => setOpen(isOpen ? null : p.employeeId)}
                  >
                    <ExpandToggle open={isOpen} />
                    <span className="font-medium text-ink">{p.fullName}</span>
                    <span className="text-ink-faint">{p.employeeCode}</span>
                    <span className="ml-auto text-ink-muted">
                      {mine
                        ? [
                            mine.lossOfPayDays > 0 && `${mine.lossOfPayDays} LOP day(s)`,
                            ...mine.inputs.map((i) => `${humanize(i.kind)} ${formatMoney(i.amount)}`),
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : '—'}
                    </span>
                  </button>
                  {isOpen && (
                    <InputsForm
                      month={month}
                      employeeId={p.employeeId}
                      current={mine}
                      onDone={() => setOpen(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function InputsForm({
  month,
  employeeId,
  current,
  onDone,
}: {
  month: string;
  employeeId: string;
  current: PayrollMonthInputs | undefined;
  onDone: () => void;
}): JSX.Element {
  const [lop, setLop] = useState(String(current?.lossOfPayDays ?? 0));
  const [rows, setRows] = useState<{ kind: PayrollInputKind; amount: string; note: string }[]>(
    current?.inputs.map((i) => ({ kind: i.kind, amount: i.amount, note: i.note ?? '' })) ?? [],
  );
  const valid =
    /^\d{1,2}$/.test(lop) && rows.every((r) => /^\d{1,12}(\.\d{1,2})?$/.test(r.amount));
  const save = usePayAction(
    () =>
      apiFetch<void>(`/payroll/inputs/${month}/${employeeId}`, {
        method: 'PUT',
        body: {
          lossOfPayDays: Number(lop),
          inputs: rows.map((r) => ({ kind: r.kind, amount: r.amount, ...(r.note.trim() ? { note: r.note.trim() } : {}) })),
        },
      }),
    'Saved. Recompute the run to apply it.',
  );
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface-sunken/40 p-3">
      <label className="flex items-center gap-2">
        <span className="w-40 text-ink-muted">Loss-of-pay days</span>
        <Input className="w-20" inputMode="numeric" value={lop} onChange={(e) => setLop(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Select
            className="w-48"
            value={r.kind}
            onChange={(e) =>
              setRows((rs) => rs.map((x, j) => (j === i ? { ...x, kind: e.target.value as PayrollInputKind } : x)))
            }
          >
            {PAYROLL_INPUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'tds' ? 'Income tax (TDS)' : humanize(k)}
              </option>
            ))}
          </Select>
          <Input
            className="w-32 text-right"
            inputMode="decimal"
            placeholder="Amount"
            value={r.amount}
            onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
          />
          <Input
            className="max-w-xs"
            placeholder="Note"
            value={r.note}
            onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
          />
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRows((rs) => [...rs, { kind: 'incentive', amount: '', note: '' }])}
        >
          Add an amount
        </Button>
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
          Save
        </Button>
      </div>
    </div>
  );
}

function Lines({ run }: { run: PayrollRunDetail }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();
  if (run.lines.length === 0) {
    return <EmptyState>No lines yet. Compute the run to work out each person’s pay.</EmptyState>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-muted">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">Deductions</th>
              <th className="px-3 py-2 text-right font-medium">Net</th>
              <th className="px-5 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {run.lines.map((l) => (
              <Fragment key={l.id}>
                <tr className="group cursor-pointer hover:bg-surface-raised" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="px-3 py-2">
                    <ExpandToggle open={open === l.id} />
                  </td>
                  <td className="py-2">
                    <span className="font-medium text-ink">{l.displayName}</span>{' '}
                    <span className="text-xs text-ink-faint">{l.employeeCode}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.payableDays}/{l.daysInMonth}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.gross)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.deductions)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(l.net)}</td>
                  <td className="px-5 py-2">
                    {l.bankChanged && <Badge tone="danger">Bank changed</Badge>}{' '}
                    {l.warnings.length > 0 && <Badge tone="warn">{l.warnings.length} note(s)</Badge>}
                  </td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={7} className="bg-surface-sunken/40 px-5 py-3">
                      <LineDetail line={l} />
                      {run.status !== 'draft' && run.status !== 'computed' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          onClick={() =>
                            void downloadFile(
                              `/payroll/runs/${run.id}/lines/${l.employeeId}/payslip.pdf`,
                              'payslip.pdf',
                            ).catch((err) => toast(errorText(err), 'error'))
                          }
                        >
                          <FileText className="h-3.5 w-3.5" /> Payslip
                        </Button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
