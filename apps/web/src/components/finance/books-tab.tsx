'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Undo2 } from 'lucide-react';
import {
  type BooksExportRecord,
  type BooksFormat,
  type BooksLedgers,
  type BooksMonth,
  type BooksSettings,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
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
import { voucherAmount } from './finance';

const FORMAT_LABEL: Record<BooksFormat, string> = {
  tally_xml: 'Tally XML',
  journal_csv: 'Journal CSV',
};

const LEDGER_LABEL: Record<keyof BooksLedgers, string> = {
  sales: 'Fees (sales)',
  outputCgst: 'Output CGST',
  outputSgst: 'Output SGST',
  outputIgst: 'Output IGST',
  tdsReceivable: 'TDS receivable',
  bank: 'Bank',
  cash: 'Cash',
  badDebts: 'Bad debts',
  adjustment: 'Adjustments',
};

const errorText = (e: unknown, fallback: string): string =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/** Books export: the month's vouchers, which have gone to the books, and the exports. */
export function BooksTab({ month }: { month: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [format, setFormat] = useState<BooksFormat>('tally_xml');
  const [ledgersOpen, setLedgersOpen] = useState(false);
  const key = ['finance', 'books', month];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<BooksMonth>(`/reports/finance/books?month=${month}`),
  });

  const fetchFile = (e: BooksExportRecord) =>
    downloadFile(
      `/reports/finance/books/exports/${e.id}/file`,
      `Books ${e.month}.${e.format === 'tally_xml' ? 'xml' : 'csv'}`,
    );

  const exportNow = useMutation({
    mutationFn: () =>
      apiFetch<BooksExportRecord>('/reports/finance/books/export', {
        method: 'POST',
        body: { month, format },
      }),
    onSuccess: async (rec) => {
      void qc.invalidateQueries({ queryKey: key });
      toast(`${rec.voucherCount} voucher${rec.voucherCount === 1 ? '' : 's'} exported.`);
      try {
        await fetchFile(rec);
      } catch (e) {
        toast(
          errorText(e, 'Exported, but the file did not download. Download it from the list.'),
          'error',
        );
      }
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: key });
      toast(errorText(e, 'Could not export.'), 'error');
    },
  });

  const undo = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/reports/finance/books/exports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast('Export undone; its vouchers are pending again.');
    },
    onError: (e) => toast(errorText(e, 'Could not undo it.'), 'error'),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <EmptyState>Could not load the books.</EmptyState>;
  const m = q.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-sm font-medium text-ink">
              {m.pending === 0
                ? 'Everything this month has gone to the books.'
                : `${m.pending} voucher${m.pending === 1 ? '' : 's'} not yet exported`}
            </div>
            <div className="text-xs text-ink-muted">
              Each voucher goes once. Create the client ledgers under Sundry Debtors in Tally, by
              the names shown.
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="Export format"
              value={format}
              onChange={(e) => setFormat(e.target.value as BooksFormat)}
              className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm"
            >
              {(Object.keys(FORMAT_LABEL) as BooksFormat[]).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={m.pending === 0 || exportNow.isPending}
              onClick={() => exportNow.mutate()}
            >
              {exportNow.isPending ? 'Exporting…' : 'Export pending'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setLedgersOpen(true)}>
              Ledger names
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vouchers ({m.vouchers.length})</CardTitle>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {m.vouchers.length === 0 ? (
            <div className="p-4 text-sm text-ink-muted">No billing this month.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Party</th>
                  <th className="px-4 py-2 font-medium">Narration</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Books</th>
                </tr>
              </thead>
              <tbody>
                {m.vouchers.map((v) => (
                  <tr
                    key={`${v.source}-${v.sourceId}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-2">{formatDate(v.date)}</td>
                    <td className="px-4 py-2">{v.type}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.number}</td>
                    <td className="px-4 py-2">{v.party}</td>
                    <td className="px-4 py-2 text-ink-muted">{v.narration}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(voucherAmount(v))}
                    </td>
                    <td className="px-4 py-2">
                      {v.exportedAt ? (
                        <Badge tone="success">Exported {formatDate(v.exportedAt)}</Badge>
                      ) : (
                        <Badge tone="warn">Pending</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {m.exports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Exports this month</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-line text-sm">
              {m.exports.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="text-ink">
                    {FORMAT_LABEL[e.format]} · {e.voucherCount} voucher
                    {e.voucherCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    {e.exportedByName ? ` · ${e.exportedByName}` : ''}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void fetchFile(e).catch((err) =>
                          toast(errorText(err, 'Could not download it.'), 'error'),
                        )
                      }
                    >
                      <Download className="h-4 w-4" aria-hidden /> File
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={undo.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Undo this export? Its vouchers become pending and go in the next export. Delete them from Tally first if you imported the file.',
                          )
                        ) {
                          undo.mutate(e.id);
                        }
                      }}
                    >
                      <Undo2 className="h-4 w-4" aria-hidden /> Undo
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {ledgersOpen && <LedgersModal settings={m.ledgers} onClose={() => setLedgersOpen(false)} />}
    </div>
  );
}

function LedgersModal({
  settings,
  onClose,
}: {
  settings: BooksSettings;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<BooksLedgers>(() => {
    const { version: _v, ...ledgers } = settings;
    return ledgers;
  });
  const keys = Object.keys(LEDGER_LABEL) as (keyof BooksLedgers)[];
  const blank = keys.some((k) => !draft[k].trim());

  const save = useMutation({
    mutationFn: () => {
      const changed: Partial<BooksLedgers> = {};
      for (const k of keys) if (draft[k].trim() !== settings[k]) changed[k] = draft[k].trim();
      return apiFetch<BooksSettings>('/reports/finance/books/settings', {
        method: 'PATCH',
        body: { version: settings.version, ...changed },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'books'] });
      toast('Ledger names saved.');
      onClose();
    },
    onError: (e) => toast(errorText(e, 'Could not save them.'), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Ledger names"
      description="The export posts to these ledgers; name them exactly as in the firm's Tally company."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={blank || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((k) => (
          <Field key={k} label={LEDGER_LABEL[k]} required>
            <Input
              value={draft[k]}
              maxLength={100}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
    </Modal>
  );
}
