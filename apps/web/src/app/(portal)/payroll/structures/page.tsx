'use client';

import { Fragment, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PERMISSION, type PayRosterRow } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, useIsPayApprover } from '@/lib/payroll';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { SalaryTab } from '@/components/payroll/salary-tab';
import { BankIdsTab } from '@/components/payroll/bank-ids-tab';

/** Everyone's pay at a glance; open a person to revise pay or bank details in place. */
export default function PayStructuresPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <Structures />
    </Suspense>
  );
}

function Structures(): JSX.Element {
  const { principal } = useAuth();
  const approver = useIsPayApprover();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [q, setQ] = useState('');
  const roster = useQuery({
    queryKey: ['payroll', 'roster'],
    queryFn: () => apiFetch<PayRosterRow[]>('/payroll/roster'),
    retry: false,
  });
  const showBank = can(principal, PERMISSION.payrollPrepare);
  const rows = (roster.data ?? []).filter((r) =>
    `${r.fullName} ${r.employeeCode} ${r.officeCode}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pay structures"
        subtitle="HR proposes pay; the Managing Partner (or the alternate) approves it. Approved pay never changes — a revision is a new structure from a date."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      {roster.isLoading ? (
        <Spinner />
      ) : roster.error ? (
        <EmptyState>{errorText(roster.error)}</EmptyState>
      ) : (
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
                  <th className="px-3 py-2 font-medium">Office</th>
                  <th className="px-3 py-2 font-medium">Pay</th>
                  <th className="px-3 py-2 text-right font-medium">A month</th>
                  <th className="px-5 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const isOpen = open === r.employeeId;
                  const monthly = r.current?.components.reduce((t, c) => t + Number(c.monthly), 0);
                  return (
                    <Fragment key={r.employeeId}>
                      <tr
                        className="group cursor-pointer hover:bg-surface-raised"
                        onClick={() => setOpen(isOpen ? null : r.employeeId)}
                      >
                        <td className="px-3 py-2">
                          <ExpandToggle open={isOpen} />
                        </td>
                        <td className="py-2">
                          <span className="font-medium text-ink">{r.fullName}</span>{' '}
                          <span className="text-xs text-ink-faint">{r.employeeCode}</span>
                          {r.dateOfExit && (
                            <span className="ml-2 text-xs text-ink-muted">left {formatDate(r.dateOfExit)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{r.officeCode}</td>
                        <td className="px-3 py-2 capitalize">
                          {r.current ? `${r.current.kind} from ${formatDate(r.current.effectiveFrom)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {monthly !== undefined ? formatMoney(monthly) : '—'}
                        </td>
                        <td className="space-x-1 px-5 py-2">
                          {r.pending > 0 && (
                            <Badge tone="warn">{approver ? 'Needs your approval' : 'Proposed'}</Badge>
                          )}
                          {!r.current && <Badge tone="neutral">No pay yet</Badge>}
                          {showBank && !r.hasBankAccount && <Badge tone="danger">No bank account</Badge>}
                          {showBank && r.openBankChange && <Badge tone="warn">Bank change to verify</Badge>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="bg-surface-sunken/40 px-5 py-4">
                            <div className={showBank ? 'grid gap-6 lg:grid-cols-2' : ''}>
                              <section>
                                <h3 className="mb-2 text-sm font-semibold text-ink">Salary</h3>
                                <SalaryTab employeeId={r.employeeId} />
                              </section>
                              {showBank && (
                                <section>
                                  <h3 className="mb-2 text-sm font-semibold text-ink">Bank &amp; IDs</h3>
                                  <BankIdsTab employeeId={r.employeeId} />
                                </section>
                              )}
                            </div>
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
                <EmptyState>No one matches.</EmptyState>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
