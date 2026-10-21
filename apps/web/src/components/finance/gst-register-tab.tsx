'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { GstOutwardRegister, GstTotals } from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { gstr1Due, registerSections, tieDifference } from './finance';

const COLUMNS: { key: keyof GstTotals; label: string }[] = [
  { key: 'taxable', label: 'Taxable' },
  { key: 'igst', label: 'IGST' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'total', label: 'Total' },
];

/** GST outward register: the month's GSTR-1 tables, the tie-out and the files. */
export function GstRegisterTab({ month }: { month: string }): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['finance', 'gst-register', month],
    queryFn: () => apiFetch<GstOutwardRegister>(`/reports/finance/gst-register?month=${month}`),
  });

  const download = async (format: 'xlsx' | 'json') => {
    setBusy(format);
    try {
      await downloadFile(
        `/reports/finance/gst-register/file?month=${month}&format=${format}`,
        `GSTR-1 ${month}.${format}`,
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not download it.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <EmptyState>Could not load the register.</EmptyState>;
  const r = q.data;
  const sections = registerSections(r);
  const t = r.tieOut;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-muted">
          GSTIN <span className="font-mono text-ink">{r.firmGstin ?? 'not set'}</span>
        </span>
        {r.filed ? (
          <Badge tone="success">Filed</Badge>
        ) : (
          <Badge tone="info">Due {formatDate(gstr1Due(month))}</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!!busy}
            onClick={() => void download('xlsx')}
          >
            <Download className="h-4 w-4" aria-hidden />{' '}
            {busy === 'xlsx' ? 'Preparing…' : 'GSTR-1 Excel'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!!busy || !r.firmGstin}
            onClick={() => void download('json')}
          >
            <Download className="h-4 w-4" aria-hidden />{' '}
            {busy === 'json' ? 'Preparing…' : 'GSTN JSON'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {sections.map((s) => (
          <Card key={s.key} className="p-3">
            <div className="text-xs text-ink-muted">{s.label}</div>
            <div className="mt-1 text-lg font-semibold text-ink">{formatMoney(s.taxable)}</div>
            <div className="text-xs text-ink-faint">
              {s.count}{' '}
              {s.key === 'b2cs'
                ? s.count === 1
                  ? 'row'
                  : 'rows'
                : s.count === 1
                  ? 'document'
                  : 'documents'}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Tie-out</CardTitle>
          {t.ok ? (
            <Badge tone="success">Ties to the invoices</Badge>
          ) : (
            <Badge tone="danger">Does not tie</Badge>
          )}
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="px-4 py-2 font-medium" />
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-4 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Invoices in the portal', t.invoices.portal],
                  ['Invoices in the register', t.invoices.register],
                  ['Difference', tieDifference(t.invoices.portal, t.invoices.register)],
                  ['Credit notes in the portal', t.creditNotes.portal],
                  ['Credit notes in the register', t.creditNotes.register],
                  ['Difference', tieDifference(t.creditNotes.portal, t.creditNotes.register)],
                ] as [string, GstTotals][]
              ).map(([label, row], i) => (
                <tr
                  key={i}
                  className={label === 'Difference' ? 'border-b border-line bg-surface-sunken' : ''}
                >
                  <td className="px-4 py-2 text-ink">{label}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {r.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>To look at before filing ({r.warnings.length})</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {r.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <Badge tone="warn">{w.code.replace(/_/g, ' ')}</Badge>
                  <span className="text-ink">{w.message}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {r.b2b.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>B2B invoices</CardTitle>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-4 py-2 font-medium">Invoice</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">GSTIN</th>
                  <th className="px-4 py-2 font-medium">POS</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {r.b2b.map((i) => (
                  <tr key={i.invoiceId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{i.invoiceNumber}</td>
                    <td className="px-4 py-2">{formatDate(i.invoiceDate)}</td>
                    <td className="px-4 py-2">{i.clientName}</td>
                    <td className="px-4 py-2 font-mono text-xs">{i.clientGstin}</td>
                    <td className="px-4 py-2">{i.placeOfSupply}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(i.invoiceValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {r.docs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Documents issued (13)</CardTitle>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-4 py-2 font-medium">Nature</th>
                  <th className="px-4 py-2 font-medium">From</th>
                  <th className="px-4 py-2 font-medium">To</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Cancelled</th>
                  <th className="px-4 py-2 text-right font-medium">Net issued</th>
                </tr>
              </thead>
              <tbody>
                {r.docs.map((d) => (
                  <tr
                    key={`${d.nature}-${d.series}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-4 py-2">
                      {d.nature === 'invoices' ? 'Invoices' : 'Credit notes'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{d.from}</td>
                    <td className="px-4 py-2 font-mono text-xs">{d.to}</td>
                    <td className="px-4 py-2 text-right">{d.total}</td>
                    <td className="px-4 py-2 text-right">{d.cancelled}</td>
                    <td className="px-4 py-2 text-right">{d.netIssued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {sections.every((s) => s.count === 0) && r.docs.length === 0 && (
        <EmptyState>No invoices or credit notes this month.</EmptyState>
      )}
    </div>
  );
}
