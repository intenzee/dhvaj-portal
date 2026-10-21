'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import type { BankMatchLine, BankMatchProposal, BankMatchResult } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { RecordReceiptModal } from '@/components/billing/record-receipt-modal';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { BANK_STATEMENT_MAX_BYTES, CONFIDENCE, fileToBase64, receiptFromMatch } from './finance';

/**
 * Bank statement match: the Accountant uploads the bank's CSV or Excel, the
 * API proposes the invoices each credit pays (TDS assumed at 10%), and a
 * proposal opens Record receipt already filled. The file is read once and
 * never stored.
 */
export function BankMatchTab(): JSX.Element {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<BankMatchResult | null>(null);
  const [recording, setRecording] = useState<{
    line: BankMatchLine;
    proposal: BankMatchProposal;
  } | null>(null);
  const [recorded, setRecorded] = useState<Set<number>>(new Set());

  const match = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > BANK_STATEMENT_MAX_BYTES)
        throw new Error('The file is larger than a month’s statement can be.');
      return apiFetch<BankMatchResult>('/reports/finance/bank-match', {
        method: 'POST',
        body: { filename: file.name, contentBase64: await fileToBase64(file) },
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setRecorded(new Set());
    },
    onError: (e) =>
      toast(
        e instanceof ApiError || e instanceof Error ? e.message : 'Could not read it.',
        'error',
      ),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Match a bank statement</div>
            <div className="text-xs text-ink-muted">
              The statement as the bank downloads it, CSV or Excel. Credits are matched to open
              invoices; nothing is recorded until you record it. The file is not kept.
            </div>
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            className="hidden"
            aria-label="Bank statement file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) match.mutate(f);
              e.target.value = '';
            }}
          />
          <Button
            className="ml-auto"
            size="sm"
            disabled={match.isPending}
            onClick={() => input.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />{' '}
            {match.isPending ? 'Reading…' : 'Upload statement'}
          </Button>
        </CardBody>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.credits} credit{result.credits === 1 ? '' : 's'}
              <span className="ml-2 text-xs font-normal text-ink-muted">
                Read “{result.columns.date}”, “{result.columns.narration}”, “{result.columns.credit}
                ”{result.debitsSkipped ? ` · ${result.debitsSkipped} debits left out` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {result.lines.length === 0 ? (
              <div className="p-4 text-sm text-ink-muted">No credits in this statement.</div>
            ) : (
              <ul className="divide-y divide-line">
                {result.lines.map((line) => (
                  <li key={line.credit.row} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="whitespace-nowrap text-ink-muted">
                        {formatDate(line.credit.date)}
                      </span>
                      <span className="font-semibold tabular-nums text-ink">
                        {formatMoney(line.credit.amount)}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-ink"
                        title={line.credit.narration}
                      >
                        {line.credit.narration}
                      </span>
                      {recorded.has(line.credit.row) ? (
                        <Badge tone="success">Recorded</Badge>
                      ) : line.recordedReceiptId ? (
                        <Badge tone="neutral">Already recorded</Badge>
                      ) : line.proposals.length === 0 ? (
                        <Badge tone="warn">No match</Badge>
                      ) : null}
                    </div>
                    {!recorded.has(line.credit.row) &&
                      !line.recordedReceiptId &&
                      line.proposals.length > 0 && (
                        <ul className="space-y-1.5 pl-4">
                          {line.proposals.map((p, i) => (
                            <li key={i} className="flex flex-wrap items-center gap-2">
                              <Badge tone={CONFIDENCE[p.confidence].tone}>
                                {CONFIDENCE[p.confidence].label}
                              </Badge>
                              <span className="font-medium text-ink">{p.clientName}</span>
                              <span className="font-mono text-xs text-ink-muted">
                                {p.invoices.map((x) => x.invoiceNumber).join(', ')}
                              </span>
                              <span className="text-xs text-ink-muted">
                                gross {formatMoney(p.gross)}
                                {Number(p.tds) > 0 ? ` · TDS ${formatMoney(p.tds)}` : ''}
                                {p.reasons.length ? ` · ${p.reasons.join('; ')}` : ''}
                              </span>
                              <Button
                                className="ml-auto"
                                variant="secondary"
                                size="sm"
                                onClick={() => setRecording({ line, proposal: p })}
                              >
                                Record receipt
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {!result && !match.isPending && (
        <EmptyState>Upload a statement to see its credits matched to open invoices.</EmptyState>
      )}

      {recording && (
        <RecordReceiptModal
          key={`${recording.line.credit.row}-${recording.proposal.clientId}`}
          open
          onClose={() => setRecording(null)}
          entity={{ id: recording.proposal.clientId, name: recording.proposal.clientName }}
          prefill={receiptFromMatch(recording.line, recording.proposal)}
          onSaved={() => setRecorded((s) => new Set(s).add(recording.line.credit.row))}
        />
      )}
    </div>
  );
}
