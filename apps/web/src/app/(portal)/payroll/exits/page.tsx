'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSION, type ExitRow } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText, useIsPayApprover } from '@/lib/payroll';
import { EXIT_STATUS_LABEL, EXIT_STATUS_TONE } from '@/lib/payroll-tax';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';
import { ExitEditor } from '@/components/payroll-tax/exit-editor';

/**
 * Full and final (spec §4.8): setting a person's exit date starts it. HR
 * prepares, the Managing Partner or the alternate approves, the run pays it.
 */
export default function PayrollExitsPage(): JSX.Element {
  const { principal } = useAuth();
  const approver = useIsPayApprover();
  const [open, setOpen] = useState<string | null>(null);
  const allowed = can(principal, PERMISSION.payrollRead) || approver;
  const list = useQuery({
    queryKey: ['payroll', 'exits'],
    queryFn: () => apiFetch<ExitRow[]>('/payroll/exits'),
    enabled: allowed,
    retry: false,
  });
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Full and final" />
        <EmptyState>
          Pay is visible only to HR, the Managing Partner and the named alternate.
        </EmptyState>
      </div>
    );
  }
  const prepares = can(principal, PERMISSION.payrollPrepare);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Full and final"
        subtitle="Wages due on exit are payable within two working days of the last day (Code on Wages). Gratuity, leave encashment and notice pay or recovery are worked out here and paid with the month’s run, which also deducts the tax."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <EmptyState>{errorText(list.error)}</EmptyState>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState>
          No one is leaving. Set an exit date on a person to start their settlement.
        </EmptyState>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Last day</th>
                  <th className="px-3 py-2 font-medium">Due by</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(list.data ?? []).map((r) => {
                  const isOpen = open === r.employeeId;
                  const late = r.status !== 'approved' && r.dueBy < today;
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
                        <td className="px-3 py-2">{formatDate(r.exitDate)}</td>
                        <td className="px-3 py-2">
                          {formatDate(r.dueBy)} {late && <Badge tone="danger">Late</Badge>}
                        </td>
                        <td className="space-x-1 px-3 py-2">
                          <Badge tone={EXIT_STATUS_TONE[r.status]}>
                            {r.status === 'submitted' && approver
                              ? 'Needs your approval'
                              : EXIT_STATUS_LABEL[r.status]}
                          </Badge>
                          {r.runStatus && (
                            <span className="text-xs text-ink-muted">run {r.runStatus}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.net ? formatMoney(r.net) : '—'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="bg-surface-sunken/40 px-5 py-4">
                            <ExitEditor
                              employeeId={r.employeeId}
                              prepares={prepares}
                              approver={approver}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
