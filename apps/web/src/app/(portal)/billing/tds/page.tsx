'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Copy, MessageCircle, Upload } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  TDS_PDF_PASSWORD_CODE,
  type RemindTdsInput,
  type TdsClientMismatch,
  type TdsCreditLine,
  type TdsImportResult,
  type TdsMatchReport,
  type TdsQuarter,
  type TdsReminderResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { blobToBase64 } from '@/lib/file-kind';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';
import { fallbackNote } from '@/components/filing/client-chase';
import {
  MATCH_KIND_LABEL,
  bookingNote,
  financialYearsFor,
  importSummary,
  tdsReminderLine,
} from '@/components/billing/tds';

type Quarter = TdsQuarter['quarter'];
const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];
const todayIst = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * PS-204 · the firm's 26AS against the TDS booked on receipts: matched, in the
 * 26AS but not booked, and booked but missing — by client, with a reminder to
 * file or correct the TDS return. Imports the TRACES text export or a Form 16A.
 */
export default function TdsPage(): JSX.Element {
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.billing);
  const allowed = can(principal, PERMISSION.billingManage) || can(principal, PERMISSION.reportRead);
  const mayManage = can(principal, PERMISSION.billingManage);
  const years = useMemo(() => financialYearsFor(todayIst()), []);
  const [year, setYear] = useState(years[0]!);
  const [quarter, setQuarter] = useState<Quarter | ''>('');
  const key = ['billing', 'tds', year, quarter] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<TdsMatchReport>(
        `/billing/tds-credits/match?financialYear=${year}${quarter ? `&quarter=${quarter}` : ''}`,
      ),
    enabled: on && allowed,
  });

  if (!on) return <EmptyState>TDS matching arrives with the new billing.</EmptyState>;
  if (!allowed) {
    return (
      <div>
        <PageHeader title="TDS against 26AS" />
        <EmptyState>You don’t have permission to view TDS credits.</EmptyState>
      </div>
    );
  }

  const r = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="TDS against 26AS"
        subtitle="TDS our clients deducted, matched to the firm’s 26AS by their TAN, the quarter and the amount."
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/billing" className="text-primary-700 hover:underline">
          ← Billing
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="w-32">
            <Select
              aria-label="Financial year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select
              aria-label="Quarter"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value as Quarter | '')}
            >
              <option value="">Whole year</option>
              {QUARTERS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </div>
          {mayManage && <ImportButton />}
        </div>
      </div>

      {q.isLoading && <Spinner label="Matching the 26AS…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the TDS match.'}
        </EmptyState>
      )}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="In the 26AS" value={r.totals.credited} />
            <Tile label="Booked on receipts" value={r.totals.booked} />
            <Tile label="Matched" value={r.totals.matched} tone="success" />
            <Tile label="In 26AS, not booked" value={r.totals.notBooked} tone="warn" />
            <Tile label="Booked, missing from 26AS" value={r.totals.missing} tone="danger" />
          </div>
          <p className="text-xs text-ink-faint">
            Amounts within {formatMoney(r.tolerance, 'INR')} match.
            {r.imports[0]
              ? ` Last import: ${r.imports[0].fileName}, ${formatDate(r.imports[0].importedAt)}${
                  r.imports[0].importedByName ? ` by ${r.imports[0].importedByName}` : ''
                }.`
              : ''}
          </p>
          {r.notes.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink">Mismatches by client</h2>
            {r.clients.length === 0 ? (
              <EmptyState>
                Every deduction booked is in the 26AS, and every credit is booked.
              </EmptyState>
            ) : (
              r.clients.map((c) => (
                <ClientMismatch
                  key={c.clientId}
                  c={c}
                  year={year}
                  quarter={quarter || null}
                  mayRemind={mayManage && r.imports.length > 0}
                />
              ))
            )}
          </section>

          {r.unknownDeductors.length > 0 && (
            <Card className="p-0">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">In the 26AS, TAN on no client</h2>
                <p className="text-xs text-ink-faint">
                  Add the TAN to the client’s registrations to match these, or they are not a
                  client’s.
                </p>
              </div>
              <CreditList credits={r.unknownDeductors} />
            </Card>
          )}

          <details className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink">
              Matched · {r.matched.length}
            </summary>
            {r.matched.length === 0 ? (
              <p className="mt-2 text-ink-faint">Nothing matched yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {r.matched.map((m) => (
                  <li
                    key={`${m.credits.map((c) => c.id).join()}|${m.receipts.map((b) => b.receiptId).join()}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                  >
                    <Link
                      href={`/billing/clients/${m.clientId}`}
                      className="min-w-[12rem] font-medium text-ink hover:underline"
                    >
                      {m.clientName}
                    </Link>
                    <Badge tone={m.kind === 'exact' ? 'success' : 'info'}>
                      {MATCH_KIND_LABEL[m.kind]}
                    </Badge>
                    <span className="text-ink-muted">
                      Booked{' '}
                      {m.receipts
                        .map(
                          (b) => `${formatMoney(b.tdsAmount, 'INR')} (${formatDate(b.receivedOn)})`,
                        )
                        .join(' + ')}
                    </span>
                    <span className="text-ink-muted">
                      · 26AS{' '}
                      {m.credits
                        .map(
                          (c) =>
                            `${formatMoney(c.tdsDeposited, 'INR')} (${formatDate(c.transactionDate)})`,
                        )
                        .join(' + ')}
                    </span>
                    {Number(m.difference) !== 0 && (
                      <span className="text-xs text-ink-faint">
                        difference {formatMoney(m.difference, 'INR')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>

          {r.imports.length > 0 && (
            <details className="text-xs text-ink-muted">
              <summary className="cursor-pointer">Imports for {year}</summary>
              <ul className="mt-1 space-y-0.5">
                {r.imports.map((b) => (
                  <li key={b.id}>
                    {formatDate(b.importedAt)} · {b.source === '26as_text' ? '26AS' : 'Form 16A'} ·{' '}
                    {b.fileName} · {b.credits} rows
                    {b.superseded ? ` · replaced ${b.superseded}` : ''}
                    {b.importedByName ? ` · ${b.importedByName}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warn' | 'danger';
}): JSX.Element {
  const colour =
    Number(value) === 0
      ? 'text-ink-faint'
      : tone === 'danger'
        ? 'text-danger-700'
        : tone === 'warn'
          ? 'text-warning-700'
          : tone === 'success'
            ? 'text-success-700'
            : 'text-ink';
  return (
    <Card className="px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${colour}`}>{formatMoney(value, 'INR')}</p>
    </Card>
  );
}

function CreditList({ credits }: { credits: TdsCreditLine[] }): JSX.Element {
  return (
    <ul className="divide-y divide-line text-sm">
      {credits.map((c) => {
        const note = bookingNote(c.bookingStatus);
        return (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2">
            <span className="flex-1">
              {c.deductorName}
              <span className="block text-xs text-ink-faint">
                {c.deductorTan} · {c.section} · {formatDate(c.transactionDate)} · {c.quarter}
                {note ? ` · ${note}` : ''}
              </span>
            </span>
            <span className="tabular-nums">{formatMoney(c.tdsDeposited, 'INR')}</span>
          </li>
        );
      })}
    </ul>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type ToSend = Exclude<TdsReminderResult, { channel: 'email' }>;

function ClientMismatch({
  c,
  year,
  quarter,
  mayRemind,
}: {
  c: TdsClientMismatch;
  year: string;
  quarter: Quarter | null;
  mayRemind: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [toSend, setToSend] = useState<ToSend | null>(null);
  const remind = useMutation({
    mutationFn: (channel: RemindTdsInput['channel'] | void) =>
      apiFetch<TdsReminderResult>('/billing/tds-credits/remind', {
        method: 'POST',
        body: {
          clientId: c.clientId,
          financialYear: year,
          ...(quarter ? { quarter } : {}),
          ...(channel ? { channel } : {}),
        },
      }),
    onSuccess: async (res) => {
      if (res.channel === 'email') {
        setToSend(null);
        toast(`Asked ${res.client} by e-mail (${res.to}).`);
      } else if (res.channel === 'whatsapp') {
        setToSend(res);
        toast('Message ready — open WhatsApp to send it.');
      } else {
        setToSend(res);
        toast((await copyText(res.text)) ? 'Copied — paste it to the client.' : 'Ready to copy.');
      }
      void qc.invalidateQueries({ queryKey: ['billing', 'tds'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not send it.', 'error'),
  });
  const last = tdsReminderLine(c.lastReminder);
  const note = toSend?.channel === 'copy' ? fallbackNote(toSend.fallback) : null;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/billing/clients/${c.clientId}`}
            className="font-medium text-ink hover:underline"
          >
            {c.clientName}
          </Link>
          <span className="block text-xs text-ink-faint">
            {c.tans.length
              ? `TAN ${c.tans.join(', ')}`
              : 'No TAN on file — add it to match their TDS'}
            {last ? ` · ${last}` : ''}
          </span>
        </div>
        {mayRemind && c.missing.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={remind.isPending}
              onClick={() => remind.mutate()}
            >
              <BellRing className="h-4 w-4" />{' '}
              {remind.isPending && !remind.variables ? 'Sending…' : 'Ask to file or correct'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remind.isPending}
              onClick={() => remind.mutate('whatsapp')}
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remind.isPending}
              onClick={() => remind.mutate('copy')}
            >
              <Copy className="h-4 w-4" /> Copy text
            </Button>
          </div>
        )}
      </div>
      {c.missing.length > 0 && (
        <div>
          <p className="px-4 pt-2 text-xs font-medium uppercase tracking-wide text-danger-700">
            Booked, missing from the 26AS · {formatMoney(c.missingTotal, 'INR')}
          </p>
          <ul className="divide-y divide-line text-sm">
            {c.missing.map((b) => (
              <li key={b.receiptId} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1">
                  Receipt of {formatDate(b.receivedOn)}
                  {b.reference ? ` · ${b.reference}` : ''}
                  <span className="block text-xs text-ink-faint">
                    {b.tdsSection && b.tdsSection !== 'other' ? `${b.tdsSection} · ` : ''}
                    {b.quarter} · gross {formatMoney(b.grossAmount, 'INR')}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoney(b.tdsAmount, 'INR')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.notBooked.length > 0 && (
        <div className="border-t border-line">
          <p className="px-4 pt-2 text-xs font-medium uppercase tracking-wide text-warning-700">
            In the 26AS, not booked · {formatMoney(c.notBookedTotal, 'INR')}
          </p>
          <CreditList credits={c.notBooked} />
        </div>
      )}
      {toSend && (
        <div className="space-y-2 border-t border-line bg-surface-sunken px-4 py-3 text-sm">
          {note && <p className="text-xs text-warning-700">{note}</p>}
          <pre className="whitespace-pre-wrap font-sans text-xs text-ink">{toSend.text}</pre>
          {toSend.channel === 'whatsapp' ? (
            <a
              href={toSend.waUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
            >
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () =>
                toast((await copyText(toSend.text)) ? 'Copied.' : 'Could not copy.')
              }
            >
              <Copy className="h-4 w-4" /> Copy again
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function ImportButton(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<TdsImportResult | null>(null);
  // A TRACES PDF waiting for its password (held only in this form, never kept).
  const [locked, setLocked] = useState<{ file: File; wrong: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const upload = useMutation({
    mutationFn: async ({ file, password }: { file: File; password?: string }) =>
      apiFetch<TdsImportResult>('/billing/tds-credits/import', {
        method: 'POST',
        body: {
          filename: file.name,
          contentType: file.type || undefined,
          contentBase64: await blobToBase64(file),
          password: password || undefined,
        },
      }),
    onSuccess: (res) => {
      setResult(res);
      setLocked(null);
      setPassword('');
      toast(importSummary(res));
      void qc.invalidateQueries({ queryKey: ['billing', 'tds'] });
    },
    onError: (e, { file }) => {
      if (e instanceof ApiError && e.body?.reason === TDS_PDF_PASSWORD_CODE) {
        setLocked({ file, wrong: e.body.wrongPassword === true });
        setPassword('');
        return;
      }
      toast(e instanceof ApiError ? e.message : 'Could not import the file.', 'error');
    },
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".txt,.pdf,text/plain,application/pdf"
        className="hidden"
        aria-label="26AS or Form 16A file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          setLocked(null);
          if (file) upload.mutate({ file });
        }}
      />
      <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
        <Upload className="h-4 w-4" /> {upload.isPending ? 'Importing…' : 'Import 26AS or Form 16A'}
      </Button>
      {locked && (
        <form
          className="flex basis-full flex-wrap items-end gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.trim()) upload.mutate({ file: locked.file, password: password.trim() });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className={locked.wrong ? 'text-danger-700' : 'text-ink-muted'}>
              {locked.wrong
                ? 'That password did not open it. Try again'
                : `${locked.file.name} is password-protected`}{' '}
              — TRACES uses the date of birth or incorporation, as DDMMYYYY.
            </span>
            <Input
              type="password"
              autoComplete="off"
              inputMode="numeric"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="PDF password"
              className="w-40"
            />
          </label>
          <Button size="sm" type="submit" disabled={upload.isPending || !password.trim()}>
            Open and import
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => {
              setLocked(null);
              setPassword('');
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {result && result.warnings.length > 0 && (
        <div className="basis-full rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          <p className="font-medium">{importSummary(result)}</p>
          <ul className="mt-1 list-disc pl-4">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
