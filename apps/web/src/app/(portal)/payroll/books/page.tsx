'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSION, type PayrollRunTotals } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { formatDate, formatMoney } from '@/lib/format';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, errorText, monthLabel, monthOf } from '@/lib/payroll';
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { JournalCard, StatutoryTable, TotalsBreakdown } from '@/components/payroll/books';

/**
 * The Accountant's payroll (spec §4.8): approved runs as totals by head —
 * never a person's pay — the entry to book, and the statutory challans.
 */
export default function PayrollBooksPage(): JSX.Element {
  const { principal } = useAuth();
  if (!can(principal, PERMISSION.payrollReadSummary) && !can(principal, PERMISSION.payrollRead)) {
    return (
      <div>
        <PageHeader title="Payroll to book" />
        <EmptyState>This is the Accountant’s view of approved payroll.</EmptyState>
      </div>
    );
  }
  return <Books canRecord={can(principal, PERMISSION.payrollReadSummary)} />;
}

function Books({ canRecord }: { canRecord: boolean }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState(monthOf(-1));
  const feed = useQuery({
    queryKey: ['payroll', 'totals-feed'],
    queryFn: () => apiFetch<PayrollRunTotals[]>('/payroll/runs/totals'),
    retry: false,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll to book"
        subtitle="Approved salary and stipend runs as totals by head, with the balanced entry to book. Individual pay stays with HR."
      />
      <Card>
        <CardHeader>
          <CardTitle>Approved runs</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {feed.isLoading ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : feed.error ? (
            <div className="p-5">
              <EmptyState>{errorText(feed.error)}</EmptyState>
            </div>
          ) : (feed.data ?? []).length === 0 ? (
            <div className="p-5">
              <EmptyState>No approved payroll yet.</EmptyState>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="py-2 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Register</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Net paid</th>
                  <th className="px-5 py-2 font-medium">Bank reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {feed.data!.map((t) => (
                  <Fragment key={t.id}>
                    <tr
                      className="group cursor-pointer hover:bg-surface-raised"
                      onClick={() => setOpen(open === t.id ? null : t.id)}
                    >
                      <td className="px-3 py-2">
                        <ExpandToggle open={open === t.id} />
                      </td>
                      <td className="py-2 font-medium text-ink">{monthLabel(t.month)}</td>
                      <td className="px-3 py-2 capitalize">{t.kind}</td>
                      <td className="px-3 py-2">
                        <Badge tone={RUN_STATUS_TONE[t.status]}>{RUN_STATUS_LABEL[t.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.people}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.net)}</td>
                      <td className="px-5 py-2 text-ink-muted">
                        {t.bankReference ? `${t.bankReference} · ${formatDate(t.paidAt)}` : 'Not paid yet'}
                      </td>
                    </tr>
                    {open === t.id && (
                      <tr>
                        <td colSpan={8} className="space-y-4 bg-surface-sunken/40 px-5 py-3">
                          <TotalsBreakdown totals={t} />
                          <div>
                            <p className="mb-1 text-xs font-semibold text-ink-muted">Entry to book</p>
                            <JournalCard runId={t.id} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Statutory challans</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 p-0">
          <div className="border-b border-line p-3">
            <Field label="Month">
              <Input type="month" className="w-48" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
          {/^\d{4}-\d{2}$/.test(month) && <StatutoryTable month={month} canRecord={canRecord} />}
        </CardBody>
      </Card>
    </div>
  );
}
