'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PERMISSION,
  type BonusWorking,
  type DecideTaxProofInput,
  type Form130PartB,
  type Form138Quarter,
  type SaveTaxDeclarationInput,
  type SubmitTaxProofInput,
  type TaxDeclaration,
  type TaxDeclarationRow,
} from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, monthLabel, monthOf, useIsPayApprover, usePayAction } from '@/lib/payroll';
import { taxYearLabel, taxYearNow } from '@/lib/payroll-tax';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { DeclarationForm } from '@/components/payroll-tax/declaration-form';
import { ProofList, ProofUpload } from '@/components/payroll-tax/proofs';
import { Form130View } from '@/components/payroll-tax/tax-computation';

type Tab = 'declarations' | 'form138' | 'bonus';

/**
 * Income tax on salary (spec §4.8, phase 2b): declarations and proofs, TDS as
 * the runs project it (s.392), the quarterly Form 138 statement, Form 130
 * Part B, and the statutory bonus.
 */
export default function TaxDeclarationsPage(): JSX.Element {
  const { principal } = useAuth();
  const approver = useIsPayApprover();
  const [year, setYear] = useState(taxYearNow());
  const [tab, setTab] = useState<Tab>('declarations');
  if (!can(principal, PERMISSION.payrollRead) && !approver) {
    return (
      <div>
        <PageHeader title="Income tax on salary" />
        <EmptyState>
          Pay is visible only to HR, the Managing Partner and the named alternate.
        </EmptyState>
      </div>
    );
  }
  const prepares = can(principal, PERMISSION.payrollPrepare);
  const years = [taxYearNow() + 1, taxYearNow(), taxYearNow() - 1, taxYearNow() - 2];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Income tax on salary"
        subtitle="Declarations and proofs, the TDS each run deducts (s.392), the quarter’s Form 138 statement, Form 130 for each person, and the statutory bonus."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Tax year">
          <Select className="w-40" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {taxYearLabel(y)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-1" role="tablist">
          {(
            [
              ['declarations', 'Declarations'],
              ['form138', 'Form 138'],
              ['bonus', 'Bonus'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              role="tab"
              aria-selected={tab === key}
              variant={tab === key ? 'subtle' : 'ghost'}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {tab === 'declarations' && <Declarations year={year} prepares={prepares} />}
      {tab === 'form138' && <Form138 year={year} prepares={prepares} />}
      {tab === 'bonus' && <Bonus year={year} prepares={prepares} />}
    </div>
  );
}

function Declarations({ year, prepares }: { year: number; prepares: boolean }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['payroll', 'tax', year, 'declarations'],
    queryFn: () => apiFetch<TaxDeclarationRow[]>(`/payroll/tax/${year}/declarations`),
    retry: false,
  });
  if (list.isLoading) return <Spinner />;
  if (list.error) return <EmptyState>{errorText(list.error)}</EmptyState>;
  const rows = (list.data ?? []).filter((r) =>
    `${r.fullName} ${r.employeeCode}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Card>
      <CardBody className="p-0">
        <div className="border-b border-line p-3">
          <Input
            className="max-w-xs"
            placeholder="Find a person"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-muted">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Regime</th>
              <th className="px-3 py-2 font-medium">Proofs</th>
              <th className="px-3 py-2 text-right font-medium">Tax for the year</th>
              <th className="px-3 py-2 text-right font-medium">TDS so far</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const isOpen = open === r.employeeId;
              return (
                <Fragment key={r.employeeId}>
                  <tr
                    className="cursor-pointer hover:bg-surface-raised"
                    onClick={() => setOpen(isOpen ? null : r.employeeId)}
                  >
                    <td className="px-3 py-2">
                      <ExpandToggle open={isOpen} />
                    </td>
                    <td className="py-2">
                      <span className="font-medium text-ink">{r.fullName}</span>{' '}
                      <span className="text-xs text-ink-faint">{r.employeeCode}</span>
                    </td>
                    <td className="space-x-1 px-3 py-2">
                      <span className="capitalize">{r.regime}</span>
                      {!r.declared && <Badge tone="warn">Not declared</Badge>}
                      {r.lockedAt && <Badge tone="neutral">Locked</Badge>}
                    </td>
                    <td className="space-x-1 px-3 py-2">
                      {r.proofsPending > 0 && <Badge tone="warn">{r.proofsPending} to check</Badge>}
                      {r.proofsAccepted > 0 && (
                        <Badge tone="success">{r.proofsAccepted} accepted</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(r.projectedTax)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(r.tdsToDate)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="bg-surface-sunken/40 px-5 py-4">
                        <DeclarationDetail
                          year={year}
                          employeeId={r.employeeId}
                          prepares={prepares}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-5">
            <EmptyState>No one on a salary this year.</EmptyState>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DeclarationDetail({
  year,
  employeeId,
  prepares,
}: {
  year: number;
  employeeId: string;
  prepares: boolean;
}): JSX.Element {
  const base = `/payroll/tax/${year}/declarations/${employeeId}`;
  const d = useQuery({
    queryKey: ['payroll', 'tax', year, 'declaration', employeeId],
    queryFn: () => apiFetch<TaxDeclaration>(base),
  });
  const f130 = useQuery({
    queryKey: ['payroll', 'tax', year, 'form130', employeeId],
    queryFn: () => apiFetch<Form130PartB>(`/payroll/tax/${year}/form130/${employeeId}`),
    retry: false,
  });
  const save = usePayAction(
    (input: SaveTaxDeclarationInput) =>
      apiFetch<TaxDeclaration>(base, { method: 'PUT', body: input }),
    'Declaration saved.',
  );
  const lock = usePayAction(
    (input: { version: number; locked: boolean }) =>
      apiFetch<TaxDeclaration>(`${base}/lock`, { method: 'POST', body: input }),
    (r) => (r.lockedAt ? 'Declaration locked.' : 'Declaration unlocked.'),
  );
  const decide = usePayAction(
    ({ id, input }: { id: string; input: DecideTaxProofInput }) =>
      apiFetch<TaxDeclaration>(`/payroll/tax/proofs/${id}/decision`, {
        method: 'POST',
        body: input,
      }),
    'Proof decided.',
  );
  const submit = usePayAction(
    (input: SubmitTaxProofInput) =>
      apiFetch<TaxDeclaration>(`${base}/proofs`, { method: 'POST', body: input }),
    'Proof filed.',
  );
  if (d.isLoading) return <Spinner />;
  if (d.error || !d.data) return <EmptyState>{errorText(d.error)}</EmptyState>;
  const decl = d.data;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Declaration</h3>
          {prepares && decl.id && (
            <Button
              size="sm"
              variant="secondary"
              disabled={lock.isPending}
              onClick={() => lock.mutate({ version: decl.version, locked: !decl.lockedAt })}
            >
              {decl.lockedAt ? 'Unlock' : 'Lock for the year’s close'}
            </Button>
          )}
        </div>
        <DeclarationForm
          key={`${decl.id}-${decl.version}`}
          value={decl}
          readOnly={!prepares}
          saving={save.isPending}
          onSave={(input) => save.mutate(input)}
        />
      </section>
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-ink">Proofs</h3>
        <ProofList
          proofs={decl.proofs}
          deciding={decide.isPending}
          onDecide={prepares ? (id, input) => decide.mutate({ id, input }) : undefined}
        />
        {prepares && decl.id && (
          <ProofUpload busy={submit.isPending} onSubmit={(i) => submit.mutateAsync(i)} />
        )}
        <h3 className="pt-2 text-sm font-semibold text-ink">Form 130 Part B</h3>
        {f130.isLoading ? (
          <Spinner />
        ) : f130.error || !f130.data ? (
          <EmptyState>{errorText(f130.error)}</EmptyState>
        ) : (
          <Form130View f={f130.data} />
        )}
      </section>
    </div>
  );
}

function Form138({ year, prepares }: { year: number; prepares: boolean }): JSX.Element {
  const toast = useToast();
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);
  const q = useQuery({
    queryKey: ['payroll', 'tax', year, 'form138', quarter],
    queryFn: () => apiFetch<Form138Quarter>(`/payroll/tax/${year}/form138/${quarter}`),
    retry: false,
  });
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Quarter">
            <Select
              className="w-48"
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
            >
              <option value={1}>Q1 (Apr–Jun)</option>
              <option value={2}>Q2 (Jul–Sep)</option>
              <option value={3}>Q3 (Oct–Dec)</option>
              <option value={4}>Q4 (Jan–Mar)</option>
            </Select>
          </Field>
          {q.data && (
            <span className="pb-2 text-sm text-ink-muted">Due {formatDate(q.data.dueOn)}</span>
          )}
          {prepares && (
            <Button
              variant="secondary"
              onClick={() =>
                void downloadFile(
                  `/payroll/tax/${year}/form138/${quarter}/file`,
                  `form138-${year}-q${quarter}.xlsx`,
                ).catch((e) => toast(errorText(e), 'error'))
              }
            >
              Workbook for the return utility
            </Button>
          )}
        </div>
        {q.isLoading ? (
          <Spinner />
        ) : q.error || !q.data ? (
          <EmptyState>{errorText(q.error)}</EmptyState>
        ) : (
          <>
            {q.data.warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg bg-warning-50 py-2 pl-8 pr-3 text-sm text-warning-700">
                {q.data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Challans</h3>
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-ink-muted">
                  <tr>
                    <th className="py-2 font-medium">Month</th>
                    <th className="px-3 py-2 text-right font-medium">TDS in the runs</th>
                    <th className="px-3 py-2 text-right font-medium">Deposited</th>
                    <th className="px-3 py-2 font-medium">Challan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data.challans.map((c) => (
                    <tr key={c.month}>
                      <td className="py-2">{monthLabel(c.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(c.tdsInRuns)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.amount)}</td>
                      <td className="px-3 py-2">
                        {c.challanNumber ? `${c.challanNumber} · ${formatDate(c.paidOn)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Deductees</h3>
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-ink-muted">
                  <tr>
                    <th className="py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">PAN</th>
                    <th className="px-3 py-2 font-medium">Month</th>
                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                    <th className="px-3 py-2 text-right font-medium">TDS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data.deductees.map((r) => (
                    <tr key={`${r.employeeId}-${r.month}`}>
                      <td className="py-2">
                        {r.fullName}{' '}
                        <span className="text-xs text-ink-faint">{r.employeeCode}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.panMasked ?? <Badge tone="danger">No PAN</Badge>}
                      </td>
                      <td className="px-3 py-2">{monthLabel(r.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(r.amountPaid)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.tds)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line font-medium">
                  <tr>
                    <td className="py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(q.data.totals.amountPaid)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(q.data.totals.tds)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Bonus({ year, prepares }: { year: number; prepares: boolean }): JSX.Element {
  const [rate, setRate] = useState('8.33');
  const [month, setMonth] = useState(monthOf(1));
  const validRate = /^\d{1,2}(\.\d{1,2})?$/.test(rate);
  const b = useQuery({
    queryKey: ['payroll', 'bonus', year, validRate ? rate : ''],
    queryFn: () =>
      apiFetch<BonusWorking>(`/payroll/bonus/${year}${validRate ? `?rate=${rate}` : ''}`),
    retry: false,
  });
  const apply = usePayAction(
    (input: { ratePercent: string; month: string }) =>
      apiFetch<BonusWorking>(`/payroll/bonus/${year}/apply`, { method: 'POST', body: input }),
    (r) => `Bonus of ${formatMoney(r.total)} put into the run's inputs.`,
  );
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Rate (%)"
            hint={b.data ? `Between ${b.data.minRate}% and ${b.data.maxRate}%.` : undefined}
          >
            <Input
              className="w-28"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          {prepares && (
            <>
              <Field label="Pay with the run of">
                <Input
                  type="month"
                  className="w-44"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </Field>
              <Button
                disabled={apply.isPending || !validRate || !/^\d{4}-\d{2}$/.test(month)}
                onClick={() => apply.mutate({ ratePercent: rate, month })}
              >
                Put into that month’s inputs
              </Button>
            </>
          )}
        </div>
        {b.isLoading ? (
          <Spinner />
        ) : b.error || !b.data ? (
          <EmptyState>{errorText(b.error)}</EmptyState>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Due by {formatDate(b.data.dueBy)}. Total {formatMoney(b.data.total)} at{' '}
              {b.data.ratePercent}%.
            </p>
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Eligible</th>
                  <th className="px-3 py-2 text-right font-medium">Bonus wages</th>
                  <th className="px-3 py-2 text-right font-medium">Bonus</th>
                  <th className="px-3 py-2 font-medium">Paid with</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.data.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td className="py-2">
                      {r.fullName} <span className="text-xs text-ink-faint">{r.employeeCode}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.eligible ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <span className="text-ink-muted">{r.reason}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(r.bonusWages)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                    <td className="px-3 py-2">
                      {r.appliedMonth ? monthLabel(r.appliedMonth) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardBody>
    </Card>
  );
}
