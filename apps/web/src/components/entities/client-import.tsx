'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, KeyRound, ShieldCheck } from 'lucide-react';
import {
  CLIENT_IMPORT_ACTION,
  GST_STATES,
  type ClientImportAction,
  type ClientImportGst,
  type ClientImportPreview,
  type ClientImportRequest,
  type ClientImportResult,
  type ClientImportRow,
  type ClientImportSheetKind,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blobToBase64 } from '@/lib/file-kind';
import { humanize } from '@/lib/format';
import type { EntityType, OfficeRow } from '@/lib/types';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { Field, Select } from '@/components/form';

/**
 * ADR-0035 — "Import client logins": the person picks the firm's login
 * workbook (GST Login and TDS Login sheets), the server reads it (here it is
 * only base64 in memory) and says what happens to each client; Import creates
 * or completes the clients, seals the logins, sets each GSTIN's monthly /
 * quarterly scheme and marks the months the sheet says were filed or NA.
 */

export const ACTION_LABEL: Record<ClientImportAction, string> = {
  create_client: 'New client',
  update_client: 'Update client',
  unchanged: 'Already here',
  error: 'Cannot import',
};
const ACTION_TONE: Record<ClientImportAction, string> = {
  create_client: 'success',
  update_client: 'info',
  unchanged: 'neutral',
  error: 'danger',
};
const SHEET_KIND_LABEL: Record<ClientImportSheetKind, string> = {
  gst: 'GST logins',
  tds: 'TDS / income-tax logins',
  skipped: 'Skipped',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-04' → 'Apr 2026'. Pure — tested. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** 'Apr 2026 – Oct 2026', or the one month. */
function monthRange(months: string[]): string | null {
  if (months.length === 0) return null;
  const first = monthLabel(months[0]!);
  const last = monthLabel(months[months.length - 1]!);
  return first === last ? first : `${first} – ${last}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Import 12 new clients, update 3, 40 logins". Pure — tested. */
export function importButtonLabel(p: ClientImportPreview): string {
  const ok = p.rows.filter((r) => r.action !== CLIENT_IMPORT_ACTION.error);
  const created = ok.filter((r) => r.action === CLIENT_IMPORT_ACTION.createClient).length;
  const updated = ok.filter((r) => r.action === CLIENT_IMPORT_ACTION.updateClient).length;
  const logins = ok.reduce((n, r) => n + r.logins.length, 0);
  const parts = [
    created ? plural(created, 'new client') : null,
    updated ? `update ${plural(updated, 'client')}` : null,
    logins ? plural(logins, 'login') : null,
  ].filter(Boolean);
  return parts.length ? `Import ${parts.join(', ')}` : 'Nothing to import';
}

/** 'Maharashtra · Quarterly · 3 filed, 1 NA'. Pure — tested. */
export function gstLine(g: ClientImportGst): string {
  return [
    g.stateCode ? (GST_STATES[g.stateCode] ?? `State ${g.stateCode}`) : null,
    g.frequency ? humanize(g.frequency) : null,
    g.filed || g.notApplicable
      ? [g.filed ? `${g.filed} filed` : null, g.notApplicable ? `${g.notApplicable} NA` : null]
          .filter(Boolean)
          .join(', ')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const hasProblem = (r: ClientImportRow): boolean =>
  r.action === CLIENT_IMPORT_ACTION.error || r.warnings.length > 0;

export function ClientImport(): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const types = useQuery({
    queryKey: ['entity-types'],
    queryFn: () => apiFetch<EntityType[]>('/entity-types'),
  });
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [officeCode, setOfficeCode] = useState(principal?.officeCode ?? '');
  const [defaultTypeSlug, setDefaultTypeSlug] = useState('proprietorship');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [result, setResult] = useState<ClientImportResult | null>(null);

  useEffect(() => {
    if (!officeCode && offices.data?.[0]) setOfficeCode(offices.data[0].code);
  }, [offices.data, officeCode]);

  const request = (): ClientImportRequest => ({
    filename: file!.name,
    contentBase64: file!.base64,
    officeCode,
    defaultTypeSlug,
  });
  const preview = useMutation({
    mutationFn: () =>
      apiFetch<ClientImportPreview>('/client-imports/workbook/preview', {
        method: 'POST',
        body: request(),
      }),
  });
  const run = useMutation({
    mutationFn: () =>
      apiFetch<ClientImportResult>('/client-imports/workbook', {
        method: 'POST',
        body: request(),
      }),
    onSuccess: (r) => {
      setResult(r);
      // Done with the file: forget it.
      setFile(null);
      preview.reset();
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['credentials'] });
    },
  });

  // Re-read whenever the file, office or default type changes.
  useEffect(() => {
    if (file && officeCode) preview.mutate();
  }, [file, officeCode, defaultTypeSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f: File | undefined): Promise<void> => {
    setResult(null);
    if (!f) return setFile(null);
    setFile({ name: f.name, base64: await blobToBase64(f) });
  };

  const p = preview.data;
  const rows = useMemo(
    () => (p ? (problemsOnly ? p.rows.filter(hasProblem) : p.rows) : []),
    [p, problemsOnly],
  );
  const error = (preview.error ?? run.error) as Error | null;
  const blocked = Boolean(p && !p.vaultReady && p.logins > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
            <Field
              label="Login workbook"
              hint="The firm's Excel file: the GST Login sheet (name, GSTIN, ID, password, frequency, months) and the TDS Login sheet (TAN, PAN, income-tax and TRACES logins). Other sheets are skipped."
            >
              <input
                type="file"
                accept=".xlsx,.xls"
                aria-label="Login workbook"
                onChange={(e) => void pick(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-primary-700"
              />
            </Field>
            <Field label="Office for new clients">
              <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
                {(offices.data ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type when unclear" hint="For new clients whose PAN and name do not say.">
              <Select value={defaultTypeSlug} onChange={(e) => setDefaultTypeSlug(e.target.value)}>
                {(types.data ?? [{ slug: 'proprietorship', name: 'Proprietorship' }]).map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            The file is read on the server and not kept. Passwords are encrypted before they are
            saved and are never shown in this preview. After importing, delete the workbook from
            your computer and e-mail — it holds the passwords in plain text.
          </p>
        </CardBody>
      </Card>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger-700">
          <AlertTriangle className="h-4 w-4" />
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </p>
      )}
      {preview.isPending && <p className="text-sm text-ink-muted">Reading the file…</p>}

      {result && <ImportResult result={result} />}

      {p && file && (
        <>
          {blocked && (
            <p className="flex items-center gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <AlertTriangle className="h-4 w-4" />
              This server has no encryption key yet, so the logins cannot be saved. Ask the
              administrator to set CREDENTIALS_KEYS.
            </p>
          )}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-ink-faint" />
                <span className="font-medium">{file.name}</span>
                <span className="text-ink-muted">
                  · {plural(p.rows.length, 'client')} · {plural(p.logins, 'login')}
                  {p.marks > 0 && ` · ${plural(p.marks, 'filed / NA mark')}`}
                  {monthRange(p.months) && ` · months ${monthRange(p.months)}`}
                </span>
              </div>
              <ul className="space-y-0.5 text-xs">
                {p.sheets.map((s) => (
                  <li key={s.name} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-ink">“{s.name}”</span>
                    <span className={s.kind === 'skipped' ? 'text-ink-faint' : 'text-ink-muted'}>
                      {SHEET_KIND_LABEL[s.kind]}
                      {s.kind !== 'skipped' && ` · ${plural(s.rows, 'row')}`}
                    </span>
                    {s.note && <span className="text-ink-faint">· {s.note}</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(Object.keys(ACTION_LABEL) as ClientImportAction[])
                  .filter((a) => p.counts[a] > 0)
                  .map((a) => (
                    <Badge key={a} tone={ACTION_TONE[a]}>
                      {ACTION_LABEL[a]}: {p.counts[a]}
                    </Badge>
                  ))}
                <label className="ml-auto flex items-center gap-1.5 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={problemsOnly}
                    onChange={(e) => setProblemsOnly(e.target.checked)}
                  />
                  Only clients with problems
                </label>
              </div>
            </CardBody>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">GST registrations</th>
                  <th className="px-3 py-2">Logins</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ClientRow key={r.key} r={r} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-ink-faint">
                      No clients with problems.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => run.mutate()}
              disabled={
                run.isPending ||
                preview.isPending ||
                blocked ||
                importButtonLabel(p) === 'Nothing to import'
              }
            >
              {run.isPending ? 'Importing…' : importButtonLabel(p)}
            </Button>
            <span className="text-xs text-ink-muted">
              Clients marked “Cannot import” are skipped; fix them in the file and import again.
              Importing again is safe: nothing is added twice.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function ClientRow({ r }: { r: ClientImportRow }): JSX.Element {
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2 text-xs text-ink-faint">{r.source}</td>
      <td className="px-3 py-2">
        <span className="font-medium text-ink">{r.name}</span>
        <span className="block text-xs text-ink-muted">
          {[
            r.pan && `PAN ${r.pan}`,
            r.tan && `TAN ${r.tan}`,
            r.typeSlug && `${humanize(r.typeSlug)}${r.typeGuessed ? ' (assumed)' : ''}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {r.entityName && r.action !== CLIENT_IMPORT_ACTION.createClient && (
          <span className="block text-xs text-ink-muted">→ {r.entityName}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.gst.length === 0 && <span className="text-ink-faint">—</span>}
        {r.gst.map((g) => (
          <span key={`${g.sheet}-${g.row}`} className="block">
            <span className="font-mono">{g.gstin ?? 'GSTIN to come'}</span>
            {gstLine(g) && <span className="text-ink-muted"> · {gstLine(g)}</span>}
          </span>
        ))}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.logins.length === 0 && <span className="text-ink-faint">—</span>}
        {r.logins.map((l) => (
          <span
            key={`${l.portal}-${l.account}-${l.target}`}
            className="mb-0.5 flex items-center gap-1"
          >
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <span className="text-ink-muted">{l.target}</span>
            <span className="font-mono">{l.usernameHint} · ••••••</span>
          </span>
        ))}
      </td>
      <td className="px-3 py-2">
        <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
        {r.error && <span className="mt-1 block text-xs text-danger-700">{r.error}</span>}
        {r.warnings.map((w) => (
          <span key={w} className="mt-1 block text-xs text-warning-700">
            {w}
          </span>
        ))}
      </td>
    </tr>
  );
}

/** What the import did, line by line. Pure — tested. */
export function resultLines(r: ClientImportResult): string[] {
  const lines = [
    [
      plural(r.clientsCreated, 'new client'),
      `${plural(r.clientsUpdated, 'client')} updated`,
      `${r.unchanged} already here`,
    ].join(' · '),
    [
      `${plural(r.registrationsAdded, 'registration')} added`,
      `${plural(r.loginsSaved, 'login')} saved (encrypted)`,
      `${plural(r.schemesSet, 'GSTIN')} set monthly / quarterly`,
    ].join(' · '),
  ];
  if (r.marksApplied || r.marksAlreadyDone)
    lines.push(
      `${plural(r.marksApplied, 'filing')} marked filed or NA` +
        (r.marksAlreadyDone ? ` · ${r.marksAlreadyDone} already were` : ''),
    );
  if (r.marksWithoutFiling)
    lines.push(
      `${plural(r.marksWithoutFiling, 'filed / NA mark')} not applied: the client has no GST engagement for that month yet. Import the workbook again once it has.`,
    );
  if (r.marksNotAllowed)
    lines.push(
      `${plural(r.marksNotAllowed, 'filed / NA mark')} left for the engagement's partner or manager.`,
    );
  return lines;
}

function ImportResult({ result }: { result: ClientImportResult }): JSX.Element {
  return (
    <Card>
      <CardBody className="space-y-2 text-sm">
        <p className="font-medium text-ink">Imported.</p>
        {resultLines(result).map((l) => (
          <p key={l}>{l}</p>
        ))}
        {result.failed.length > 0 && (
          <div>
            <p className="text-danger-700">
              {result.failed.length === 1
                ? '1 client was not imported:'
                : `${result.failed.length} clients were not imported:`}
            </p>
            <ul className="ml-4 list-disc text-xs text-ink-muted">
              {result.failed.map((f) => (
                <li key={`${f.source}-${f.name}`}>
                  {f.name} ({f.source}): {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.notes.length > 0 && (
          <div>
            <p className="text-warning-700">To know:</p>
            <ul className="ml-4 list-disc text-xs text-ink-muted">
              {result.notes.map((n, i) => (
                <li key={`${n.source}-${i}`}>
                  {n.name} ({n.source}): {n.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-warning-700">
          Now delete the workbook: the portal has the logins, encrypted.
        </p>
        <Link href="/entities" className="text-primary-700 hover:underline">
          Go to Clients
        </Link>
      </CardBody>
    </Card>
  );
}
