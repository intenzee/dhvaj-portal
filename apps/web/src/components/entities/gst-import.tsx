'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, KeyRound, ShieldCheck } from 'lucide-react';
import {
  GST_IMPORT_ACTION,
  GST_IMPORT_FIELDS,
  GST_IMPORT_FIELD_LABEL,
  type GstImportAction,
  type GstImportMapping,
  type GstImportPreview,
  type GstImportRequest,
  type GstImportResult,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blobToBase64 } from '@/lib/file-kind';
import { humanize } from '@/lib/format';
import type { OfficeRow } from '@/lib/types';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { Field, Select } from '@/components/form';

/**
 * ADR-0035 — "Import GST clients": the person picks their spreadsheet, the
 * server reads it (here it is only base64 in memory) and says what each row
 * will do; Import creates the clients and GSTINs and seals the logins.
 */

export const ACTION_LABEL: Record<GstImportAction, string> = {
  create_client: 'New client',
  add_registration: 'Add GSTIN to client',
  update_login: 'Save login',
  unchanged: 'Already here',
  error: 'Cannot import',
};
const ACTION_TONE: Record<GstImportAction, string> = {
  create_client: 'success',
  add_registration: 'info',
  update_login: 'info',
  unchanged: 'neutral',
  error: 'danger',
};

/** "Import 12 new clients, 3 GSTINs and 15 logins". Pure — tested. */
export function importButtonLabel(p: GstImportPreview): string {
  const newClients = new Set(
    p.rows.filter((r) => r.action === GST_IMPORT_ACTION.createClient).map((r) => r.pan),
  ).size;
  const added = p.counts.add_registration;
  const logins = p.rows.filter((r) => r.hasLogin && r.action !== GST_IMPORT_ACTION.error).length;
  const parts = [
    newClients ? `${newClients} new client${newClients === 1 ? '' : 's'}` : null,
    added ? `${added} GSTIN${added === 1 ? '' : 's'} to existing clients` : null,
    logins ? `${logins} login${logins === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.length ? `Import ${parts.join(', ')}` : 'Nothing to import';
}

export function GstClientImport(): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [officeCode, setOfficeCode] = useState(principal?.officeCode ?? '');
  const [mapping, setMapping] = useState<Partial<GstImportMapping>>({});
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [result, setResult] = useState<GstImportResult | null>(null);

  useEffect(() => {
    if (!officeCode && offices.data?.[0]) setOfficeCode(offices.data[0].code);
  }, [offices.data, officeCode]);

  const request = (): GstImportRequest => ({
    filename: file!.name,
    contentBase64: file!.base64,
    officeCode,
    mapping,
  });
  const preview = useMutation({
    mutationFn: () =>
      apiFetch<GstImportPreview>('/client-imports/gst/preview', {
        method: 'POST',
        body: request(),
      }),
  });
  const run = useMutation({
    mutationFn: () =>
      apiFetch<GstImportResult>('/client-imports/gst', { method: 'POST', body: request() }),
    onSuccess: (r) => {
      setResult(r);
      // Done with the file: forget it.
      setFile(null);
      preview.reset();
      void qc.invalidateQueries({ queryKey: ['entities'] });
    },
  });

  // Re-read whenever the file, office or column choice changes.
  useEffect(() => {
    if (file && officeCode) preview.mutate();
  }, [file, officeCode, mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f: File | undefined): Promise<void> => {
    setResult(null);
    setMapping({});
    if (!f) return setFile(null);
    setFile({ name: f.name, base64: await blobToBase64(f) });
  };

  const p = preview.data;
  const rows = useMemo(
    () =>
      p ? (problemsOnly ? p.rows.filter((r) => r.action === 'error' || r.message) : p.rows) : [],
    [p, problemsOnly],
  );
  const error = (preview.error ?? run.error) as Error | null;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <Field
              label="Spreadsheet"
              hint="Excel (.xlsx, .xls) or CSV with a GSTIN column; a client name, GST user name and password columns are picked up too."
            >
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                aria-label="Spreadsheet"
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
          </div>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
            The file is read on the server and not kept. Passwords are encrypted before they are
            saved and are never shown in this preview. After importing, delete the spreadsheet from
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

      {result && (
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-medium text-ink">Imported.</p>
            <p>
              {result.clientsCreated} new clients · {result.registrationsAdded} GSTINs added ·{' '}
              {result.loginsSaved} logins saved (encrypted) · {result.unchanged} already here
            </p>
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
                      Row {f.row} {f.gstin && `(${f.gstin})`}: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-warning-700">
              Now delete the spreadsheet: the portal has the logins, encrypted.
            </p>
            <Link href="/entities" className="text-primary-700 hover:underline">
              Go to Clients
            </Link>
          </CardBody>
        </Card>
      )}

      {p && file && (
        <>
          {!p.vaultReady && p.rows.some((r) => r.hasLogin) && (
            <p className="flex items-center gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <AlertTriangle className="h-4 w-4" />
              This server has no encryption key yet, so the logins cannot be saved. Ask the
              administrator to set CREDENTIALS_KEYS.
            </p>
          )}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-ink-faint" />
                <span className="font-medium">{file.name}</span>
                <span className="text-ink-muted">
                  · sheet “{p.sheet}” · {p.rows.length} rows
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {GST_IMPORT_FIELDS.map((f) => (
                  <Field key={f} label={GST_IMPORT_FIELD_LABEL[f]}>
                    <Select
                      aria-label={`Column for ${GST_IMPORT_FIELD_LABEL[f]}`}
                      value={p.mapping[f] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))}
                    >
                      <option value="">— not in the file —</option>
                      {p.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(Object.keys(ACTION_LABEL) as GstImportAction[])
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
                  <th className="px-3 py-2">GSTIN</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">GST login</th>
                  <th className="px-3 py-2">What happens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-ink-faint">{r.row}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.gstin || '—'}</td>
                    <td className="px-3 py-2">
                      {r.legalName}
                      {r.tradeName && <span className="text-ink-muted"> · {r.tradeName}</span>}
                      {r.entityName && r.action !== 'create_client' && (
                        <span className="block text-xs text-ink-muted">→ {r.entityName}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.typeSlug ? humanize(r.typeSlug) : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.hasLogin ? (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <KeyRound className="h-3.5 w-3.5 text-ink-faint" />
                          {r.usernameHint} · ••••••
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                      {r.message && (
                        <span
                          className={`mt-1 block text-xs ${r.action === 'error' ? 'text-danger-700' : 'text-warning-700'}`}
                        >
                          {r.message}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => run.mutate()}
              disabled={
                run.isPending ||
                preview.isPending ||
                importButtonLabel(p) === 'Nothing to import' ||
                (!p.vaultReady && p.rows.some((r) => r.hasLogin))
              }
            >
              {run.isPending ? 'Importing…' : importButtonLabel(p)}
            </Button>
            <span className="text-xs text-ink-muted">
              Rows marked “Cannot import” are skipped; fix them in the file and import again.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
