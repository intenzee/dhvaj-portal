'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  GitMerge,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import {
  CLIENT_IMPORT_ACTION,
  CLIENT_MASTER_PASSWORDS_MASKED_HEADER,
  CLIENT_MASTER_PASSWORDS_SHOWN_HEADER,
  PERMISSION,
  STREAM_LABEL,
  type ClientImportAction,
  type ClientMasterEngagement,
  type ClientMasterPreview,
  type ClientMasterRequest,
  type ClientMasterResult,
  type ClientMasterRow,
} from '@hsdg/contracts';
import { ApiError, apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { blobToBase64 } from '@/lib/file-kind';
import type { OfficeRow } from '@/lib/types';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { ACTION_LABEL } from './client-import';
import { MergeClientsModal, VerdictBadge } from './merge-clients-modal';

/**
 * The Client Master workbook: Export gives every client in the firm's
 * template with what the portal has, so the gaps (PAN, GSTIN, TAN, contact,
 * address, services) show; the person fills them — or adds rows for new
 * clients — and imports the file back. The preview says, row by row, what
 * the import fills in, adds or opens; nothing already in the portal is
 * wiped by an empty cell.
 */

const ACTION_TONE: Record<ClientImportAction, string> = {
  create_client: 'success',
  update_client: 'info',
  unchanged: 'neutral',
  error: 'danger',
};
const MATCHED_BY: Record<NonNullable<ClientMasterRow['matchedBy']>, string> = {
  code: 'client code',
  gstin: 'GSTIN',
  pan: 'PAN',
  tan: 'TAN',
  name: 'name',
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Import 4 new clients, fill in 20, 3 engagements". Pure — tested. */
export function masterButtonLabel(p: ClientMasterPreview): string {
  const created = p.counts[CLIENT_IMPORT_ACTION.createClient];
  const updated = p.counts[CLIENT_IMPORT_ACTION.updateClient];
  const parts = [
    created ? plural(created, 'new client') : null,
    updated ? `fill in ${plural(updated, 'client')}` : null,
    p.logins ? plural(p.logins, 'login') : null,
    p.engagements ? plural(p.engagements, 'engagement') : null,
  ].filter(Boolean);
  return parts.length ? `Import: ${parts.join(', ')}` : 'Nothing to import';
}

/** 'New Compliance engagement 2026-27: GST, TDS / TCS'. Pure — tested. */
export function masterEngagementLabel(e: ClientMasterEngagement): string {
  const services = e.streams.map((s) => STREAM_LABEL[s]).join(', ');
  if (e.action === 'create') return `New Compliance engagement ${e.financialYear}: ${services}`;
  if (e.action === 'add_year')
    return `${e.financialYear} added to ${e.engagementCode}: ${services}`;
  if (e.action === 'add_streams')
    return `${services} added to ${e.engagementCode} for ${e.financialYear}`;
  return `Already in ${e.engagementCode} for ${e.financialYear}`;
}

const hasProblem = (r: ClientMasterRow): boolean =>
  r.action === CLIENT_IMPORT_ACTION.error || r.warnings.length > 0 || !!r.duplicate;

/** '12 passwords written in full · 3 left masked'. Pure — tested. */
export function passwordExportLine(shown: number, masked: number): string {
  const parts = [`${plural(shown, 'password')} written in full`];
  if (masked) parts.push(`${masked} left masked (clients whose logins you may not see)`);
  return parts.join(' · ');
}

/**
 * "Export with passwords": the same workbook with each login written in
 * full, for the clients whose logins the person may reveal. Shown only with
 * credential.reveal; the warning sits inline, not in a pop-up.
 */
export function ExportWithPasswords(): JSX.Element | null {
  const { principal } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!can(principal, PERMISSION.credentialReveal)) return null;
  const run = async (): Promise<void> => {
    setBusy(true);
    setDone(null);
    setFailed(null);
    try {
      const headers = await downloadFile(
        '/client-imports/master/export?passwords=true',
        'DHVAJ-Client-Master-with-passwords.xlsx',
      );
      setDone(
        passwordExportLine(
          Number(headers.get(CLIENT_MASTER_PASSWORDS_SHOWN_HEADER) ?? 0),
          Number(headers.get(CLIENT_MASTER_PASSWORDS_MASKED_HEADER) ?? 0),
        ),
      );
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setFailed(
        status === 429
          ? 'Exported with passwords 5 times in the last hour — try again later.'
          : status === 403
            ? 'You do not have the right to see client passwords.'
            : 'The export failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void run()} disabled={busy}>
          <KeyRound className="h-4 w-4" />
          {busy ? 'Exporting…' : 'Export with passwords'}
        </Button>
        <span className="text-xs text-warning-700">
          Writes each login in full for the clients whose logins you may see; the rest stay masked.
          Every password exported is logged against your name. The file then holds real passwords —
          share it only with people who may see them, and delete it after use.
        </span>
      </div>
      {done && <p className="mt-1.5 text-xs text-success-700">{done}</p>}
      {failed && (
        <p role="alert" className="mt-1.5 text-xs text-danger-700">
          {failed}
        </p>
      )}
    </div>
  );
}

/** "Export client master": the clients in the workbook, ready to fill. */
export function ExportClientMasterButton({
  variant = 'secondary',
}: {
  variant?: 'primary' | 'secondary';
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      await downloadFile('/client-imports/master/export', 'DHVAJ-Client-Master.xlsx');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant={variant}
      onClick={() => void run()}
      disabled={busy}
      title={failed ? 'The export failed — try again.' : undefined}
    >
      <Download className="h-4 w-4" />
      {busy ? 'Exporting…' : failed ? 'Export failed — retry' : 'Export client master'}
    </Button>
  );
}

export function ClientMaster(): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [officeCode, setOfficeCode] = useState(principal?.officeCode ?? '');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [result, setResult] = useState<ClientMasterResult | null>(null);

  useEffect(() => {
    if (!officeCode && offices.data?.[0]) setOfficeCode(offices.data[0].code);
  }, [offices.data, officeCode]);

  const request = (): ClientMasterRequest => ({
    filename: file!.name,
    contentBase64: file!.base64,
    officeCode,
  });
  const preview = useMutation({
    mutationFn: () =>
      apiFetch<ClientMasterPreview>('/client-imports/master/preview', {
        method: 'POST',
        body: request(),
      }),
  });
  const run = useMutation({
    mutationFn: () =>
      apiFetch<ClientMasterResult>('/client-imports/master', { method: 'POST', body: request() }),
    onSuccess: (r) => {
      setResult(r);
      setFile(null);
      preview.reset();
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['engagements'] });
      void qc.invalidateQueries({ queryKey: ['credentials'] });
    },
  });

  // Re-read whenever the file or the office changes.
  useEffect(() => {
    if (file && officeCode) preview.mutate();
  }, [file, officeCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f: File | undefined): Promise<void> => {
    setResult(null);
    if (!f) return setFile(null);
    setFile({ name: f.name, base64: await blobToBase64(f) });
  };

  const p = preview.data;
  const rows = useMemo(
    () =>
      (p?.rows ?? []).filter(
        (r) =>
          (!problemsOnly || hasProblem(r)) &&
          (showUnchanged || r.action !== CLIENT_IMPORT_ACTION.unchanged),
      ),
    [p, problemsOnly, showUnchanged],
  );
  const error = (preview.error ?? run.error) as Error | null;
  const blocked = Boolean(p && !p.vaultReady && p.logins > 0);
  const label = p ? masterButtonLabel(p) : '';

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <ol className="ml-4 list-decimal space-y-1 text-sm text-ink-muted">
            <li>
              Export the client master: every client with what the portal has, the gaps left empty.
            </li>
            <li>
              Fill in the empty cells in Excel, and add a row for each new client — its GST,
              Income-tax, TRACES, MCA and E-way bill logins go in the Logins columns of its row. The
              check columns at the end flag a mistyped PAN or GSTIN, or a login missing its
              password.
            </li>
            <li>Choose the filled file below, read the preview, then import.</li>
          </ol>
          <ExportClientMasterButton />
          <ExportWithPasswords />
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <Field
              label="Filled client master"
              hint="The DHVAJ Client Master .xlsx (Clients sheet; Logins sheet optional)."
            >
              <input
                type="file"
                accept=".xlsx"
                aria-label="Filled client master"
                onChange={(e) => void pick(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-primary-700"
              />
            </Field>
            <Field
              label="Office for new clients"
              hint='When a row leaves "Home office code" blank.'
            >
              <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
                {(offices.data ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            The file is read on the server and not kept. An empty cell never removes anything; a PAN
            already on a client is never replaced. Passwords — in a row&apos;s Logins columns or on
            the Logins sheet — are encrypted before saving; a masked “(saved in portal)” changes
            nothing. Delete the file afterwards if it holds passwords.
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

      {result && <MasterResult result={result} />}

      {p && file && (
        <>
          {blocked && (
            <p className="flex items-center gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <AlertTriangle className="h-4 w-4" />
              This server has no encryption key yet, so the logins cannot be saved. Clear the login
              columns and the Logins sheet, or ask the administrator to set CREDENTIALS_KEYS.
            </p>
          )}
          {p.loginProblems.length > 0 && (
            <div className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {plural(p.loginProblems.length, 'login')} will be skipped:
              </p>
              <ul className="ml-6 list-disc text-xs">
                {p.loginProblems.map((l) => (
                  <li key={l.row}>
                    Row {l.row}: {l.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-ink-faint" />
                <span className="font-medium">{file.name}</span>
                <span className="text-ink-muted">
                  · {plural(p.rows.length, 'row')} · {plural(p.logins, 'login')} ·{' '}
                  {plural(p.engagements, 'engagement')} to open or extend
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(Object.keys(ACTION_LABEL) as ClientImportAction[])
                  .filter((a) => p.counts[a] > 0)
                  .map((a) => (
                    <Badge key={a} tone={ACTION_TONE[a]}>
                      {a === CLIENT_IMPORT_ACTION.updateClient ? 'Fill in' : ACTION_LABEL[a]}:{' '}
                      {p.counts[a]}
                    </Badge>
                  ))}
                <label className="ml-auto flex items-center gap-1.5 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={showUnchanged}
                    onChange={(e) => setShowUnchanged(e.target.checked)}
                  />
                  Show rows with nothing new
                </label>
                <label className="flex items-center gap-1.5 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={problemsOnly}
                    onChange={(e) => setProblemsOnly(e.target.checked)}
                  />
                  Only rows with problems
                </label>
              </div>
            </CardBody>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">What it fills in or adds</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <MasterRowView
                    key={r.row}
                    r={r}
                    // The row now meets one client: read the file again.
                    onMerged={() => preview.mutate()}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-ink-faint">
                      {problemsOnly ? 'No rows with problems.' : 'No row adds anything new.'}
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
                run.isPending || preview.isPending || blocked || label === 'Nothing to import'
              }
            >
              {run.isPending ? 'Importing…' : label}
            </Button>
            <span className="text-xs text-ink-muted">
              Rows marked “Cannot import” are skipped; fix them in the file and import again.
              Importing again is safe: it only fills what is still missing.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function MasterRowView({ r, onMerged }: { r: ClientMasterRow; onMerged: () => void }): JSX.Element {
  const [merging, setMerging] = useState(false);
  const dupe = r.duplicate;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2 text-xs text-ink-faint">{r.row}</td>
      <td className="px-3 py-2">
        <span className="font-medium text-ink">{r.name}</span>
        {r.entityCode && (
          <span className="block text-xs text-ink-muted">
            {r.entityCode}
            {r.matchedBy && ` · found by ${MATCHED_BY[r.matchedBy]}`}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.changes.length === 0 && r.logins === 0 && <span className="text-ink-faint">—</span>}
        {r.changes.map((c, i) => (
          <span key={`${c.field}-${i}`} className="block">
            <span className="text-ink-muted">{c.field}: </span>
            {c.from && <span className="text-ink-faint line-through">{c.from}</span>}
            {c.from && ' → '}
            <span className="text-ink">{c.to}</span>
          </span>
        ))}
        {r.logins > 0 && (
          <span className="block text-ink-muted">{plural(r.logins, 'login')} (encrypted)</span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge tone={ACTION_TONE[r.action]}>
          {r.action === CLIENT_IMPORT_ACTION.updateClient ? 'Fill in' : ACTION_LABEL[r.action]}
        </Badge>
        {r.engagement && r.action !== CLIENT_IMPORT_ACTION.error && (
          <span className="mt-1 block">
            <Badge tone={r.engagement.action === 'existing' ? 'neutral' : 'info'}>
              {masterEngagementLabel(r.engagement)}
            </Badge>
          </span>
        )}
        {r.error && <span className="mt-1 block text-xs text-danger-700">{r.error}</span>}
        {r.warnings.map((w) => (
          <span key={w} className="mt-1 block text-xs text-warning-700">
            {w}
          </span>
        ))}
        {dupe && (
          <span className="mt-1.5 block rounded-md bg-warning-50 px-2 py-1.5 text-xs">
            <span className="flex flex-wrap items-center gap-1.5 text-warning-700">
              Meets two clients: {dupe.entityCodes[0]} and {dupe.entityCodes[1]}
              <VerdictBadge verdict={dupe.verdict} />
            </span>
            {dupe.reasons[0] && <span className="block text-ink-muted">{dupe.reasons[0]}</span>}
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => setMerging(true)}>
              <GitMerge className="h-3.5 w-3.5" /> Merge these clients
            </Button>
          </span>
        )}
        {merging && dupe && (
          <MergeClientsModal
            clientIds={dupe.entityIds}
            onClose={() => setMerging(false)}
            onMerged={onMerged}
          />
        )}
      </td>
    </tr>
  );
}

/** What the import did, line by line. Pure — tested. */
export function masterResultLines(r: ClientMasterResult): string[] {
  const lines = [
    [
      plural(r.clientsCreated, 'new client'),
      `${plural(r.clientsUpdated, 'client')} filled in`,
      `${r.unchanged} had nothing new`,
    ].join(' · '),
  ];
  const added = [
    r.fieldsFilled ? `${plural(r.fieldsFilled, 'detail')} filled` : null,
    r.registrationsAdded ? `${plural(r.registrationsAdded, 'GSTIN / TAN / CIN')} added` : null,
    r.contactsAdded ? `${plural(r.contactsAdded, 'contact')} added` : null,
    r.addressesAdded ? `${plural(r.addressesAdded, 'address', 'addresses')} added` : null,
    r.schemesSet ? `${plural(r.schemesSet, 'GSTIN')} set monthly / quarterly` : null,
    r.loginsSaved ? `${plural(r.loginsSaved, 'login')} saved (encrypted)` : null,
  ].filter(Boolean);
  if (added.length) lines.push(added.join(' · '));
  if (r.engagementsCreated || r.engagementsExtended)
    lines.push(
      [
        r.engagementsCreated
          ? `${plural(r.engagementsCreated, 'Compliance engagement')} opened`
          : null,
        r.engagementsExtended
          ? `${plural(r.engagementsExtended, 'engagement')} given a year or services`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  return lines;
}

function MasterResult({ result }: { result: ClientMasterResult }): JSX.Element {
  return (
    <Card>
      <CardBody className="space-y-2 text-sm">
        <p className="font-medium text-ink">Imported.</p>
        {masterResultLines(result).map((l) => (
          <p key={l}>{l}</p>
        ))}
        {result.failed.length > 0 && (
          <div>
            <p className="text-danger-700">
              {result.failed.length === 1
                ? '1 row was not imported:'
                : `${result.failed.length} rows were not imported:`}
            </p>
            <ul className="ml-4 list-disc text-xs text-ink-muted">
              {result.failed.map((f) => (
                <li key={f.row}>
                  Row {f.row}, {f.name}: {f.message}
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
                <li key={`${n.row}-${i}`}>
                  Row {n.row}, {n.name}: {n.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href="/entities" className="text-primary-700 hover:underline">
            Go to Clients
          </Link>
          <ExportClientMasterButton />
        </div>
      </CardBody>
    </Card>
  );
}
