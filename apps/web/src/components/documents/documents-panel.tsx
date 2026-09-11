'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Download,
  Archive,
  RotateCcw,
  Trash2,
  Pencil,
  Maximize2,
  FileText,
} from 'lucide-react';
import { DOCUMENT_TYPES, DOCUMENT_CLASSIFICATIONS, ROLE, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile, fetchBlob } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can, hasRole } from '@/lib/principal';
import { PERMISSION } from '@hsdg/contracts';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Card, EmptyState, Badge, Button, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { detectKind } from '@/lib/file-kind';

/** How a document is filed — drives the list filter and pre-scopes new uploads. */
export interface DocumentScope {
  taskId?: string;
  componentInstanceId?: string;
}

/** Read a File as base64 (without the data: prefix) + its content type. */
function readFileBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      const base64 = result.slice(result.indexOf(',') + 1);
      resolve({ base64, contentType: file.type || 'application/octet-stream' });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Documents filed under a scope (an engagement, a task, or a component-work
 * period), with a live SIDE PREVIEW so you can see what's in a file without
 * fully opening it. Anyone who can see a document can edit it (Edit opens the
 * in-app / Office editor); leads upload and archive; only a managing partner or
 * admin can permanently delete. Reused across the engagement Documents tab, the
 * per-task drawer and the per-GST-month drawer.
 */
export function DocumentsPanel({
  engagementId,
  scope,
  scopeLabel,
  className,
}: {
  engagementId: string;
  scope?: DocumentScope;
  /** Shown in the upload dialog so the user knows where the file will be filed. */
  scopeLabel?: string;
  className?: string;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const canDelete = hasRole(principal, ROLE.managingPartner, ROLE.admin);

  const taskId = scope?.taskId;
  const componentInstanceId = scope?.componentInstanceId;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [full, setFull] = useState<{ doc: DocumentRow; mode: 'view' | 'edit' } | null>(null);
  const [deleteFor, setDeleteFor] = useState<DocumentRow | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const queryKey = [
    'engagement',
    engagementId,
    'documents',
    {
      taskId: taskId ?? null,
      componentInstanceId: componentInstanceId ?? null,
      deleted: showDeleted,
    },
  ];

  const docs = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (taskId) params.set('taskId', taskId);
      if (componentInstanceId) params.set('componentInstanceId', componentInstanceId);
      if (showDeleted) params.set('deleted', 'true');
      return apiFetch<Paginated<DocumentRow>>(
        `/engagements/${engagementId}/documents?${params.toString()}`,
      );
    },
  });

  const items = docs.data?.items ?? [];
  const selected = items.find((d) => d.id === selectedId) ?? null;

  // Keep a valid selection: default to the first document; clear if it vanishes.
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((d) => d.id === selectedId)) {
      setSelectedId(items[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.data]);

  const invalidate = (): void => void qc.invalidateQueries({ queryKey });

  const archive = useMutation({
    mutationFn: (d: DocumentRow) =>
      apiFetch(
        `/engagements/${engagementId}/documents/${d.id}/${d.status === 'archived' ? 'restore' : 'archive'}`,
        {
          method: 'POST',
          body: { reason: d.status === 'archived' ? 'Restored' : 'Archived', version: d.version },
        },
      ),
    onSuccess: (_r, d) => {
      toast(d.status === 'archived' ? 'Document restored.' : 'Document archived.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  const restore = useMutation({
    mutationFn: (d: DocumentRow) =>
      apiFetch(`/engagements/${engagementId}/documents/${d.id}/undelete`, {
        method: 'POST',
        body: { reason: 'Restored' },
      }),
    onSuccess: () => {
      toast('Document restored.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not restore.', 'error'),
  });

  const download = async (d: DocumentRow): Promise<void> => {
    try {
      await downloadFile(
        `/engagements/${engagementId}/documents/${d.id}/download`,
        d.currentFilename ?? d.title,
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          {showDeleted ? 'Deleted documents' : 'Documents'}
          {items.length > 0 && <span className="ml-1.5 text-ink-faint">({items.length})</span>}
        </h2>
        <div className="flex items-center gap-2">
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowDeleted((v) => !v);
                setSelectedId(null);
              }}
              title="Deleted documents are retained and can be restored"
            >
              {showDeleted ? 'Show live' : 'Show deleted'}
            </Button>
          )}
          {canManage && !showDeleted && (
            <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" /> Upload
            </Button>
          )}
        </div>
      </div>

      <Card className="grid grid-cols-1 gap-0 overflow-hidden p-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* ── List pane ─────────────────────────────────────────────────── */}
        <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
          {docs.isLoading && (
            <div className="p-5">
              <Spinner />
            </div>
          )}
          {docs.isSuccess && items.length === 0 && (
            <div className="p-5">
              <EmptyState>No documents here yet.</EmptyState>
            </div>
          )}
          {items.length > 0 && (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {items.map((d) => {
                const active = d.id === selectedId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-primary-50' : 'hover:bg-surface-sunken'
                      }`}
                    >
                      <FileText
                        className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-primary-600' : 'text-ink-faint'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {d.title}
                        </span>
                        <span className="block truncate text-xs text-ink-faint">
                          {d.currentFilename ?? '—'} · v{d.currentVersionNo}
                        </span>
                      </span>
                      {d.status === 'archived' && (
                        <Badge tone="neutral" className="shrink-0">
                          Archived
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Side preview pane ─────────────────────────────────────────── */}
        <div className="min-w-0 bg-surface-raised/40">
          {selected ? (
            <PreviewPane
              key={selected.id}
              engagementId={engagementId}
              doc={selected}
              canManage={canManage}
              canDelete={canDelete}
              deletedView={showDeleted}
              archiving={archive.isPending}
              restoring={restore.isPending}
              onOpen={(mode) => setFull({ doc: selected, mode })}
              onDownload={() => void download(selected)}
              onArchiveToggle={() => archive.mutate(selected)}
              onDelete={() => setDeleteFor(selected)}
              onRestore={() => restore.mutate(selected)}
            />
          ) : (
            <div className="flex h-full min-h-[16rem] items-center justify-center p-6 text-center text-sm text-ink-faint">
              Select a document to preview it here.
            </div>
          )}
        </div>
      </Card>

      {uploadOpen && (
        <UploadModal
          engagementId={engagementId}
          scope={scope}
          scopeLabel={scopeLabel}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            invalidate();
          }}
        />
      )}

      {full && (
        <DocumentPreview
          engagementId={engagementId}
          doc={full.doc}
          initialMode={full.mode}
          onClose={() => setFull(null)}
          onSaved={invalidate}
        />
      )}

      {deleteFor && (
        <DeleteModal
          engagementId={engagementId}
          doc={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDone={() => {
            setDeleteFor(null);
            setSelectedId(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/** The right-hand pane: a live inline preview of one document plus its actions. */
function PreviewPane({
  engagementId,
  doc,
  canManage,
  canDelete,
  deletedView,
  archiving,
  restoring,
  onOpen,
  onDownload,
  onArchiveToggle,
  onDelete,
  onRestore,
}: {
  engagementId: string;
  doc: DocumentRow;
  canManage: boolean;
  canDelete: boolean;
  deletedView: boolean;
  archiving: boolean;
  restoring: boolean;
  onOpen: (mode: 'view' | 'edit') => void;
  onDownload: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onRestore: () => void;
}): JSX.Element {
  const kind = useMemo(
    () => detectKind(doc.currentContentType, doc.currentFilename ?? doc.title),
    [doc.currentContentType, doc.currentFilename, doc.title],
  );
  const [preview, setPreview] = useState<{
    loading: boolean;
    url?: string;
    text?: string;
    error?: string;
  }>({ loading: true });

  // Inline-preview the lightweight kinds (image / pdf / text / csv). Office
  // formats can't render as a plain blob — offer Open/Edit instead.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const inlineable = kind === 'image' || kind === 'pdf' || kind === 'text' || kind === 'csv';
    if (!inlineable) {
      setPreview({ loading: false });
      return;
    }
    setPreview({ loading: true });
    (async () => {
      try {
        const { blob } = await fetchBlob(
          `/engagements/${engagementId}/documents/${doc.id}/download`,
        );
        if (cancelled) return;
        if (kind === 'text' || kind === 'csv') {
          const text = await blob.text();
          if (!cancelled) setPreview({ loading: false, text });
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setPreview({ loading: false, url: objectUrl });
        }
      } catch (err) {
        if (!cancelled)
          setPreview({
            loading: false,
            error: err instanceof ApiError ? err.message : 'Could not load the preview.',
          });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [engagementId, doc.id, kind]);

  return (
    <div className="flex h-full flex-col">
      {/* Meta + actions */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{doc.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
            <StatusBadge status={doc.status} />
            <Badge>{humanize(doc.documentType)}</Badge>
            <Badge>{humanize(doc.classification)}</Badge>
            <span>v{doc.currentVersionNo}</span>
            <span>· {formatDate(doc.updatedAt)}</span>
            {doc.createdByName && <span>· {doc.createdByName}</span>}
          </div>
        </div>
      </div>

      {/* Inline preview */}
      <div className="min-h-[14rem] flex-1 overflow-auto p-3">
        {preview.loading && (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading preview…" />
          </div>
        )}
        {!preview.loading && preview.error && (
          <div className="flex h-full items-center justify-center text-sm text-danger-600">
            {preview.error}
          </div>
        )}
        {!preview.loading && !preview.error && kind === 'image' && preview.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={doc.title} className="mx-auto max-h-[24rem] object-contain" />
        )}
        {!preview.loading && !preview.error && kind === 'pdf' && preview.url && (
          <iframe title={doc.title} src={preview.url} className="h-[24rem] w-full border-0" />
        )}
        {!preview.loading &&
          !preview.error &&
          (kind === 'text' || kind === 'csv') &&
          preview.text !== undefined && (
            <pre className="whitespace-pre-wrap break-words rounded bg-surface p-3 text-xs text-ink">
              {preview.text.slice(0, 20000)}
              {preview.text.length > 20000 && '\n…'}
            </pre>
          )}
        {!preview.loading && !preview.error && !['image', 'pdf', 'text', 'csv'].includes(kind) && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FileText className="h-10 w-10 text-ink-faint" />
            <p className="text-sm text-ink-muted">
              {humanize(kind)} file — open it to view or edit in the editor.
            </p>
            <Button size="sm" onClick={() => onOpen('view')}>
              <Maximize2 className="h-4 w-4" /> Open
            </Button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        {deletedView ? (
          <>
            <span className="text-xs text-ink-faint">
              Deleted{doc.deletedAt ? ` · ${formatDate(doc.deletedAt)}` : ''} — hidden from everyone
              but retained.
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={onDownload}>
              <Download className="h-4 w-4" /> Download
            </Button>
            {canDelete && (
              <Button size="sm" disabled={restoring} onClick={onRestore}>
                <RotateCcw className="h-4 w-4" /> {restoring ? 'Restoring…' : 'Restore'}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => onOpen('view')}>
              <Maximize2 className="h-4 w-4" /> Open
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpen('edit')}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button size="sm" variant="secondary" onClick={onDownload}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <div className="flex-1" />
            {canManage && (
              <Button size="sm" variant="ghost" disabled={archiving} onClick={onArchiveToggle}>
                {doc.status === 'archived' ? (
                  <>
                    <RotateCcw className="h-4 w-4" /> Restore
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" /> Archive
                  </>
                )}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                className="text-danger-600 hover:bg-danger-50"
                title="Delete — hidden everywhere, retained, restorable (managing partner only)"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UploadModal({
  engagementId,
  scope,
  scopeLabel,
  onClose,
  onDone,
}: {
  engagementId: string;
  scope?: DocumentScope;
  scopeLabel?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('working_paper');
  const [classification, setClassification] = useState('internal');

  const upload = useMutation({
    mutationFn: async () => {
      const { base64, contentType } = await readFileBase64(file!);
      return apiFetch(`/engagements/${engagementId}/documents`, {
        method: 'POST',
        body: {
          title: title.trim() || file!.name,
          documentType,
          classification,
          filename: file!.name,
          contentType,
          contentBase64: base64,
          ...(scope?.taskId ? { taskId: scope.taskId } : {}),
          ...(scope?.componentInstanceId
            ? { componentInstanceId: scope.componentInstanceId }
            : {}),
        },
      });
    },
    onSuccess: () => {
      toast('Document uploaded.');
      onDone();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload document"
      description={
        scopeLabel
          ? `Filed under ${scopeLabel}. Stored as versioned evidence; downloads are audited.`
          : 'Stored as versioned evidence; downloads are audited.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="File" required>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
            className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
          />
        </Field>
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Classification">
            <Select value={classification} onChange={(e) => setClassification(e.target.value)}>
              {DOCUMENT_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DeleteModal({
  engagementId,
  doc,
  onClose,
  onDone,
}: {
  engagementId: string;
  doc: DocumentRow;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');

  const del = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/documents/${doc.id}/delete`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      toast('Document deleted.');
      onDone();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Delete failed.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete document"
      description="The document is hidden from everyone across the portal. Its versions and audit trail are retained, and a managing partner can restore it later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || del.isPending}
            onClick={() => del.mutate()}
            className="bg-danger-600 hover:bg-danger-700"
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          Deleting <span className="font-medium text-ink">{doc.title}</span>. Consider
          <span className="font-medium"> Archive</span> instead if you only need to set it aside —
          archived documents stay visible in the list.
        </p>
        <Field label="Reason" required>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being deleted? (audited)"
          />
        </Field>
      </div>
    </Modal>
  );
}
