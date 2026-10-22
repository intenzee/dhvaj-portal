'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import type { PayrollRunSummary } from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, errorText, monthLabel } from '@/lib/payroll';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';
import { JournalCard } from '@/components/payroll/books';

const FINAL = new Set(['approved', 'paid', 'locked']);

/** Salary and stipend registers of approved runs (downloads are audited), with the entry to book. */
export default function PayrollRegistersPage(): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => apiFetch<PayrollRunSummary[]>('/payroll/runs'),
    retry: false,
  });
  const rows = (runs.data ?? []).filter((r) => FINAL.has(r.status));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Registers"
        subtitle="Every approved run. Each register download is recorded in the audit trail."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      {runs.isLoading ? (
        <Spinner />
      ) : runs.error ? (
        <EmptyState>{errorText(runs.error)}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No approved run yet.</EmptyState>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-muted">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="py-2 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Register</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className="group cursor-pointer hover:bg-surface-raised"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      <td className="px-3 py-2">
                        <ExpandToggle open={open === r.id} />
                      </td>
                      <td className="py-2 font-medium text-ink">{monthLabel(r.month)}</td>
                      <td className="px-3 py-2 capitalize">{r.kind}</td>
                      <td className="px-3 py-2">
                        <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.net)}</td>
                      <td className="px-3 py-2 text-ink-muted">{r.paidAt ? formatDate(r.paidAt) : '—'}</td>
                      <td className="px-5 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadFile(
                              `/payroll/runs/${r.id}/register.xlsx`,
                              `${r.kind}-register-${r.month}.xlsx`,
                            ).catch((err) => toast(errorText(err), 'error'));
                          }}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" /> Register
                        </Button>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={8} className="bg-surface-sunken/40 px-5 py-3">
                          <p className="mb-2 text-xs font-semibold text-ink-muted">Entry to book</p>
                          <JournalCard runId={r.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
