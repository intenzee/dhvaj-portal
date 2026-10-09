'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileSpreadsheet, History } from 'lucide-react';
import { PERMISSION, type FsWorkbookCreated, type FsWorkbookView } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { DocumentPreview } from '@/components/document-preview';
import { VersionHistory } from './acceptance-file-card';

/**
 * The Financial Statements Workbook card (DHVAJ 02.3 spec §16, §18). Once 02.2
 * and 02.3 establish the framework it offers "Create Financial Statements
 * Workbook": the API picks the firm's approved Excel template (framework +
 * Division + entity type + financial year + template effective version) and
 * creates it in the engagement's SharePoint workspace. The card then opens the
 * same file in Microsoft 365 (AutoSave — no download / re-upload), shows its
 * SharePoint version history, and the template and framework version it was
 * created from. Nothing is chosen in the browser.
 */
export function FsWorkbookCard({
  engagementId,
  workflowInstanceId,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const scheduleBase = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/schedule-iii`;
  const url = `${scheduleBase}/workbook`;
  const key = ['engagement', engagementId, 'fs-workbook', workflowInstanceId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<FsWorkbookView>(url) });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);

  if (q.isLoading) return <Spinner label="Loading the workbook…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the workbook.'}
      </p>
    );
  }
  const view = q.data;
  const wb = view.workbook;
  const sel = view.selection;
  const editable = canManage && !view.readOnly && can(principal, PERMISSION.engagementManage);
  const fail = (e: unknown) =>
    toast(e instanceof ApiError ? e.message : 'Could not open the workbook.', 'error');

  const open = async (documentId: string): Promise<void> => {
    try {
      setOpenDoc(
        await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`),
      );
    } catch (e) {
      fail(e);
    }
  };
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiFetch<FsWorkbookCreated>(url, { method: 'POST', body: {} });
      qc.setQueryData(key, res.view);
      toast(
        res.missingFields.length
          ? `Workbook created — fill in: ${res.missingFields.join(', ')}.`
          : 'Financial Statements Workbook created.',
      );
      if (res.editorUrl) window.open(res.editorUrl, '_blank', 'noopener,noreferrer');
      else await open(res.documentId);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 text-sm" aria-label="Financial Statements Workbook">
      {wb ? (
        <div className="rounded-md border border-line bg-surface p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 text-success-600" aria-hidden />
              <span className="truncate text-ink">{wb.filename ?? wb.title}</span>
              {wb.inSharePoint && <Badge tone="info">SharePoint</Badge>}
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => void open(wb.documentId)}>
                <ExternalLink className="h-3.5 w-3.5" />{' '}
                {view.m365Enabled ? 'Open in Microsoft 365' : 'Open'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={history}
                onClick={() => setHistory((o) => !o)}
              >
                <History className="h-3.5 w-3.5" /> Version History
              </Button>
            </span>
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Meta
              label="Template"
              value={`${wb.templateKey} · ${wb.templateVariantKey} · version ${wb.templateVersionNo}`}
            />
            <Meta
              label="Framework version"
              value={
                wb.frameworkId
                  ? `${wb.frameworkId}${wb.frameworkVersionLabel ? ` — ${wb.frameworkVersionLabel}` : ''}`
                  : '—'
              }
            />
            <Meta label="Financial year" value={wb.financialYear ?? '—'} />
            <Meta
              label="Created"
              value={`${formatDate(wb.createdAt)}${wb.createdByName ? ` by ${wb.createdByName}` : ''}`}
            />
            <Meta
              label="Current file"
              value={`v${wb.currentVersionNo}${wb.lastEditedBy ? ` · last edited by ${wb.lastEditedBy}` : ''}`}
            />
          </dl>
          {history && <VersionHistory base={scheduleBase} fileId="workbook" />}
          <p className="mt-2 text-[11px] text-ink-faint">
            Edit it in Microsoft 365 from here — AutoSave keeps the same SharePoint file. It stays
            on the template version it was created from.
          </p>
        </div>
      ) : (
        <>
          {sel && (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <Meta label="Template" value={sel.templateTitle} />
              <Meta
                label="Framework"
                value={`${sel.frameworkId} — Division ${sel.division} · ${sel.frameworkVersionLabel}`}
              />
              <Meta label="Entity type" value={sel.entityTypeSlug ?? '—'} />
              <Meta label="Financial year" value={sel.financialYear ?? '—'} />
              <Meta
                label="Template version"
                value={
                  sel.templateVersionNo
                    ? `${sel.templateVariantKey} · version ${sel.templateVersionNo}`
                    : 'None approved yet'
                }
              />
            </dl>
          )}
          {view.reason && <p className="text-xs text-warning-700">{view.reason}</p>}
          {editable && view.available && (
            <Button size="sm" disabled={busy} onClick={() => void create()}>
              <FileSpreadsheet className="h-3.5 w-3.5" />{' '}
              {busy ? 'Creating…' : 'Create Financial Statements Workbook'}
            </Button>
          )}
        </>
      )}
      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={editable}
          onClose={() => setOpenDoc(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: key })}
        />
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      <dt className="text-ink-faint">{label}:</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
