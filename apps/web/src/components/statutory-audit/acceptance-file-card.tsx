'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, FileText, History, Link2, Lock, Trash2, Upload, ExternalLink } from 'lucide-react';
import {
  ACCEPTANCE_FILE_DATE_META,
  ACCEPTANCE_FILE_META_LABEL,
  ACCEPTANCE_FILE_STATUS_LABEL,
  ENGAGEMENT_LETTER_DELIVERY_MODES,
  PREVIOUS_AUDITOR_SENT_MODES,
  availableFileTransitions,
  fileTransitionError,
  slotOf,
  type AcceptanceFileRecord,
  type AcceptanceFileSlotDefinition,
  type AcceptanceFileStatus,
  type AcceptanceFileTransition,
  type AcceptanceFilesView,
  type FileVersionHistory,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { acceptanceFilesBase, useAcceptanceFiles, useAcceptanceFilesRefresh } from './acceptance-files';

/**
 * A Section 01 file card (spec §2): one slot — the consent certificate, the
 * communication to the previous auditor, the engagement letter, evidence for
 * an answer — with Create from DHVAJ Template, Add File, Link Existing File,
 * Open (Microsoft 365 when enabled), Version History and the slot's status
 * steps. Everything opens inline under the card; a status step that needs
 * details (sent date, mode, a reason to reopen) asks for them in place.
 *
 * Final / sent / approved work is locked: it opens read-only and takes no new
 * versions until the card is reopened with a reason.
 */
export function AcceptanceFileCard({
  engagementId,
  workflowInstanceId,
  slotKey,
  editable,
  title,
  hint,
}: {
  engagementId: string;
  workflowInstanceId: string;
  slotKey: string;
  editable: boolean;
  /** Overrides the slot's own title. */
  title?: string;
  /** One line under the title (e.g. what the file should evidence). */
  hint?: string;
}): JSX.Element | null {
  const def = slotOf(slotKey);
  const query = useAcceptanceFiles(engagementId, workflowInstanceId);
  if (!def) return null;
  if (query.isLoading) return <Spinner label="Loading files…" />;
  const view = query.data;
  if (!view) return null;
  return (
    <SlotCard
      engagementId={engagementId}
      workflowInstanceId={workflowInstanceId}
      slotKey={slotKey}
      def={def}
      view={view}
      editable={editable && !view.sectionLocked}
      title={title ?? def.title}
      hint={hint}
    />
  );
}

const STATUS_TONE: Partial<Record<AcceptanceFileStatus, string>> = {
  draft: 'warn',
  ready_to_send: 'info',
  partner_review: 'info',
  final: 'success',
  sent: 'success',
  approved: 'success',
  issued: 'success',
  accepted: 'success',
};

function SlotCard({
  engagementId,
  workflowInstanceId,
  slotKey,
  def,
  view,
  editable,
  title,
  hint,
}: {
  engagementId: string;
  workflowInstanceId: string;
  slotKey: string;
  def: AcceptanceFileSlotDefinition;
  view: AcceptanceFilesView;
  editable: boolean;
  title: string;
  hint?: string;
}): JSX.Element {
  const toast = useToast();
  const refresh = useAcceptanceFilesRefresh(engagementId, workflowInstanceId);
  const base = acceptanceFilesBase(engagementId, workflowInstanceId);
  const files = view.files.filter((f) => f.slotKey === slotKey);
  const template = def.templateKey ? view.templates.find((t) => t.templateKey === def.templateKey) : undefined;
  const canAddMore = def.multiple || files.length === 0;
  const [linking, setLinking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error');
  const create = useMutation({
    mutationFn: () =>
      apiFetch<AcceptanceFilesView>(`${base}/create-from-template`, { method: 'POST', body: { slotKey } }),
    onSuccess: (v) => {
      refresh(v);
      toast('Created from the DHVAJ template.');
    },
    onError,
  });
  const add = useMutation({
    mutationFn: async (file: File) =>
      apiFetch<AcceptanceFilesView>(`${base}/add`, {
        method: 'POST',
        body: {
          slotKey,
          filename: file.name,
          contentType: file.type || undefined,
          contentBase64: await blobToBase64(file),
        },
      }),
    onSuccess: (v) => refresh(v),
    onError,
  });

  return (
    <div
      id={`audit-anchor-file-${slotKey.replace(':', '-')}`}
      className="rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
            {title}
          </div>
          {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
        </div>
        {files.length === 0 && <Badge>Not Created</Badge>}
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-2">
          {files.map((f) => (
            <FileRow
              key={f.id}
              engagementId={engagementId}
              base={base}
              def={def}
              file={f}
              view={view}
              editable={editable}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {editable && canAddMore && (
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap gap-2">
            {def.templateKey && (
              <Button
                size="sm"
                variant="subtle"
                disabled={!template?.available || create.isPending}
                title={template?.reason ?? undefined}
                onClick={() => create.mutate()}
              >
                <FilePlus2 className="h-4 w-4" />
                {create.isPending ? 'Creating…' : 'Create from DHVAJ Template'}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={add.isPending} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" />
              {add.isPending ? 'Uploading…' : 'Add File'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setLinking((o) => !o)} aria-expanded={linking}>
              <Link2 className="h-4 w-4" /> Link Existing File
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label={`Add a file to ${title}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) add.mutate(file);
              }}
            />
          </div>
          {def.templateKey && template && !template.available && template.reason && (
            <p className="text-[11px] text-ink-faint">{template.reason}</p>
          )}
          {def.templateKey && template?.available && (
            <p className="text-[11px] text-ink-faint">
              Template {template.variantKey && template.variantKey !== 'standard' ? `${template.variantKey} ` : ''}
              v{template.versionNo} — prefilled from the masters and Section 01 answers.
            </p>
          )}
          {linking && (
            <LinkPicker
              engagementId={engagementId}
              exclude={files.map((f) => f.documentId)}
              onPick={async (documentId) => {
                try {
                  const v = await apiFetch<AcceptanceFilesView>(`${base}/link`, {
                    method: 'POST',
                    body: { slotKey, documentId },
                  });
                  refresh(v);
                  setLinking(false);
                } catch (e) {
                  onError(e);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  engagementId,
  base,
  def,
  file,
  view,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  def: AcceptanceFileSlotDefinition;
  file: AcceptanceFileRecord;
  view: AcceptanceFilesView;
  editable: boolean;
  onChanged: (v?: AcceptanceFilesView) => void;
}): JSX.Element {
  const toast = useToast();
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [step, setStep] = useState<AcceptanceFileTransition | null>(null);
  const steps = editable ? availableFileTransitions(def, file.status, view.callerIsEngagementPartner) : [];
  const partnerSteps = def.transitions.filter((t) => t.from === file.status && t.partnerOnly);
  const awaitingPartner = editable && !view.callerIsEngagementPartner && partnerSteps.length > 0;
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error');

  const move = useMutation({
    mutationFn: (v: { to: AcceptanceFileStatus; meta?: Record<string, string | null> }) =>
      apiFetch<AcceptanceFilesView>(`${base}/${file.id}/status`, {
        method: 'POST',
        body: { status: v.to, meta: v.meta, version: file.version },
      }),
    onSuccess: (v) => {
      onChanged(v);
      setStep(null);
    },
    onError,
  });
  const unlink = useMutation({
    mutationFn: () => apiFetch<AcceptanceFilesView>(`${base}/${file.id}/unlink`, { method: 'POST' }),
    onSuccess: (v) => onChanged(v),
    onError,
  });
  const open = async (): Promise<void> => {
    try {
      setOpenDoc(await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${file.documentId}`));
    } catch (e) {
      onError(e);
    }
  };

  const metaShown = Object.entries(file.meta).filter(
    ([k, v]) => v && k !== 'reopenReason' && ACCEPTANCE_FILE_META_LABEL[k],
  );
  const removable = editable && !file.editLocked && (def.lifecycle.length === 0 || file.status === 'draft');

  return (
    <li className="rounded-md border border-line bg-surface-sunken/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm text-ink">{file.filename ?? file.title}</span>
            {def.lifecycle.length > 0 && (
              <Badge tone={STATUS_TONE[file.status] ?? 'neutral'}>{ACCEPTANCE_FILE_STATUS_LABEL[file.status]}</Badge>
            )}
            {file.editLocked && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <Lock className="h-3 w-3" /> Read-only
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-faint">
            v{file.currentVersionNo}
            {file.lastEditedBy ? ` · last edited by ${file.lastEditedBy}` : ''}
            {file.lastSavedAt ? ` · saved ${new Date(file.lastSavedAt).toLocaleString()}` : ''}
            {file.templateVersionNo
              ? ` · template ${file.templateVariantKey && file.templateVariantKey !== 'standard' ? `${file.templateVariantKey} ` : ''}v${file.templateVersionNo}`
              : ''}
            {file.inSharePoint ? ' · in SharePoint' : ''}
          </p>
          {metaShown.length > 0 && (
            <p className="text-[11px] text-ink-muted">
              {metaShown.map(([k, v]) => `${ACCEPTANCE_FILE_META_LABEL[k]}: ${metaValue(k, v!)}`).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void open()}>
            <ExternalLink className="h-4 w-4" /> Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((o) => !o)} aria-expanded={showHistory}>
            <History className="h-4 w-4" /> Version History
          </Button>
          {removable && (
            <Button
              size="sm"
              variant="ghost"
              disabled={unlink.isPending}
              onClick={() => {
                if (window.confirm('Remove this file from the card? The document stays on the engagement.'))
                  unlink.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      </div>

      {(steps.length > 0 || awaitingPartner) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {steps.map((t) => (
            <Button
              key={`${t.from}-${t.to}`}
              size="sm"
              variant={t.to === 'draft' ? 'secondary' : 'primary'}
              disabled={move.isPending}
              aria-expanded={t.requires?.length ? step?.to === t.to : undefined}
              onClick={() => {
                if (t.requires?.length) setStep(step?.to === t.to ? null : t);
                else move.mutate({ to: t.to });
              }}
            >
              {t.label}
            </Button>
          ))}
          {awaitingPartner && (
            <span className="text-[11px] text-ink-faint">
              Awaiting the Engagement Partner to {partnerSteps.map((t) => t.label.toLowerCase()).join(' or ')}.
            </span>
          )}
        </div>
      )}

      {step && (
        <StepForm
          def={def}
          step={step}
          from={file.status}
          isPartner={view.callerIsEngagementPartner}
          busy={move.isPending}
          onCancel={() => setStep(null)}
          onSubmit={(meta) => move.mutate({ to: step.to, meta })}
        />
      )}

      {showHistory && <VersionHistory base={base} fileId={file.id} />}

      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={editable && !file.editLocked}
          onClose={() => setOpenDoc(null)}
          onSaved={() => onChanged()}
        />
      )}
    </li>
  );
}

function metaValue(key: string, value: string): string {
  if ((ACCEPTANCE_FILE_DATE_META as readonly string[]).includes(key)) return formatDate(value);
  const modes: ReadonlyArray<{ value: string; label: string }> =
    key === 'sentMode' ? PREVIOUS_AUDITOR_SENT_MODES : key === 'deliveryMode' ? ENGAGEMENT_LETTER_DELIVERY_MODES : [];
  return modes.find((m) => m.value === value)?.label ?? value;
}

/** The details a status step records, asked for inline under the file. */
function StepForm({
  def,
  step,
  from,
  isPartner,
  busy,
  onCancel,
  onSubmit,
}: {
  def: AcceptanceFileSlotDefinition;
  step: AcceptanceFileTransition;
  from: AcceptanceFileStatus;
  isPartner: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (meta: Record<string, string | null>) => void;
}): JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const fields = [...(step.requires ?? [])];
  // Sending / issuing may carry free remarks alongside the required details.
  if (step.to === 'sent' || step.to === 'issued') fields.push('remarks');
  const [meta, setMeta] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((k) => [k, (ACCEPTANCE_FILE_DATE_META as readonly string[]).includes(k) ? today : '']),
    ),
  );
  const error = fileTransitionError(def, from, step.to, meta, isPartner);
  const set = (k: string, v: string) => setMeta((m) => ({ ...m, [k]: v }));

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (error) return;
        onSubmit(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.trim() || null])));
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((k) => {
          const label = ACCEPTANCE_FILE_META_LABEL[k] ?? k;
          const required = step.requires?.includes(k) ?? false;
          if ((ACCEPTANCE_FILE_DATE_META as readonly string[]).includes(k)) {
            return (
              <Field key={k} label={label} required={required}>
                <Input type="date" value={meta[k]} max={today} onChange={(e) => set(k, e.target.value)} />
              </Field>
            );
          }
          if (k === 'sentMode' || k === 'deliveryMode') {
            const modes = k === 'sentMode' ? PREVIOUS_AUDITOR_SENT_MODES : ENGAGEMENT_LETTER_DELIVERY_MODES;
            return (
              <Field key={k} label={label} required={required}>
                <Select value={meta[k]} onChange={(e) => set(k, e.target.value)}>
                  <option value="">Select…</option>
                  {modes.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          return (
            <div key={k} className="sm:col-span-2">
              <Field
                label={label}
                required={required}
                hint={k === 'reopenReason' ? 'Recorded in the audit trail with who reopened it and when.' : undefined}
              >
                <Textarea rows={2} value={meta[k]} onChange={(e) => set(k, e.target.value)} />
              </Field>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={busy || error !== null}>
          {step.label}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {error && <span className="text-[11px] text-ink-faint">{error}</span>}
      </div>
    </form>
  );
}

function VersionHistory({ base, fileId }: { base: string; fileId: string }): JSX.Element {
  const q = useQuery({
    queryKey: ['acceptance-file-versions', base, fileId],
    queryFn: () => apiFetch<FileVersionHistory>(`${base}/${fileId}/versions`),
  });
  if (q.isLoading) return <Spinner label="Loading history…" />;
  if (q.error)
    return (
      <p className="mt-2 text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the history.'}
      </p>
    );
  const h = q.data!;
  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2">
      <p className="mb-1 text-[11px] text-ink-faint">
        {h.source === 'sharepoint' ? 'SharePoint version history' : 'Portal version history'}
      </p>
      {h.entries.length === 0 ? (
        <p className="text-xs text-ink-muted">No versions yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-ink-faint">
            <tr>
              <th className="py-1 font-medium">Version</th>
              <th className="py-1 font-medium">Edited by</th>
              <th className="py-1 font-medium">Saved</th>
              <th className="py-1 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {h.entries.map((e) => (
              <tr key={e.id}>
                <td className="py-1 text-ink">{e.label}</td>
                <td className="py-1 text-ink-muted">{e.editedBy ?? '—'}</td>
                <td className="py-1 text-ink-muted">{new Date(e.savedAt).toLocaleString()}</td>
                <td className="py-1 text-right text-ink-muted">
                  {e.sizeBytes == null ? '—' : `${Math.max(1, Math.round(e.sizeBytes / 1024))} KB`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Inline picker over the engagement's documents — linked, never copied. */
export function LinkPicker({
  engagementId,
  exclude,
  onPick,
}: {
  engagementId: string;
  exclude: string[];
  onPick: (documentId: string) => Promise<void>;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['engagement', engagementId, 'documents', 'link-picker', search],
    queryFn: () =>
      apiFetch<Paginated<DocumentRow>>(
        `/engagements/${engagementId}/documents?limit=10${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
      ),
  });
  const rows = (q.data?.items ?? []).filter((d) => !exclude.includes(d.id));
  return (
    <div className="mt-1 space-y-2 rounded-md border border-line bg-surface p-2">
      <Input
        placeholder="Search this engagement's documents…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search documents to link"
      />
      {q.isLoading ? (
        <Spinner label="Searching…" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-muted">No documents found.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate text-xs text-ink">
                {d.title}
                <span className="text-ink-faint"> · {d.currentFilename ?? 'no file'} · v{d.currentVersionNo}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(d.id);
                  await onPick(d.id);
                  setBusy(null);
                }}
              >
                {busy === d.id ? 'Linking…' : 'Link'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
