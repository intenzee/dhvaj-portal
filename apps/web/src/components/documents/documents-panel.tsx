'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
  CheckCircle2,
  Circle,
  Upload as UploadIcon,
} from 'lucide-react';
import {
  DOCUMENT_TYPES,
  DOCUMENT_CLASSIFICATIONS,
  ROLE,
  type Paginated,
  type ComponentDocChecklistItem,
} from '@hsdg/contracts';
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

/** One version in a document's history (subset of the API detail response). */
interface DocVersion {
  id: string;
  versionNo: number;
  filename: string;
  sizeBytes: number;
  note: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
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
  const [uploadReq, setUploadReq] = useState<{ id: string; name: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  // Required-documents checklist — only for a component-work period.
  const checklistKey = ['engagement', engagementId, 'component-work', componentInstanceId, 'checklist'];
  const checklist = useQuery({
    queryKey: checklistKey,
    queryFn: () =>
      apiFetch<ComponentDocChecklistItem[]>(
        `/engagements/${engagementId}/component-work/${componentInstanceId}/checklist`,
      ),
    enabled: !!componentInstanceId && !showDeleted,
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

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey });
    if (componentInstanceId) {
      void qc.invalidateQueries({ queryKey: checklistKey });
      // Refresh the component-work list so the grid's missing-docs flag updates.
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'component-work'] });
    }
  };

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

  // Bulk upload (drag-and-drop or multi-select): one document per file, using the
  // filename as the title and the panel's current scope. Metadata can be edited
  // afterwards. Uploads sequentially so a partial failure is clear.
  const bulkUpload = useMutation({
    mutationFn: async (files: File[]) => {
      let done = 0;
      for (const f of files) {
        const { base64, contentType } = await readFileBase64(f);
        await apiFetch(`/engagements/${engagementId}/documents`, {
          method: 'POST',
          body: {
            title: f.name.replace(/\.[^.]+$/, '') || f.name,
            documentType: 'working_paper',
            classification: 'internal',
            filename: f.name,
            contentType,
            contentBase64: base64,
            ...(taskId ? { taskId } : {}),
            ...(componentInstanceId ? { componentInstanceId } : {}),
          },
        });
        done += 1;
      }
      return done;
    },
    onSuccess: (n) => {
      toast(`Uploaded ${n} document${n === 1 ? '' : 's'}.`);
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'),
  });

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    if (!canManage || showDeleted) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) bulkUpload.mutate(files);
  };

  const canDrop = canManage && !showDeleted;

  return (
    <div
      className={`relative ${className ?? ''}`}
      onDragOver={(e) => {
        if (!canDrop) return;
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the panel itself, not moving between children.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {canDrop && dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary-500 bg-primary-50/80 text-sm font-medium text-primary-700">
          Drop files to upload{scopeLabel ? ` to ${scopeLabel}` : ''}
        </div>
      )}
      {bulkUpload.isPending && (
        <div className="mb-2 rounded-md bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700">
          Uploading…
        </div>
      )}
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

      {componentInstanceId && !showDeleted && checklist.data && checklist.data.length > 0 && (
        <ChecklistStrip
          items={checklist.data}
          canManage={canManage}
          onUploadFor={(req) => {
            setUploadReq(req);
            setUploadOpen(true);
          }}
        />
      )}

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
          requirement={uploadReq}
          onClose={() => {
            setUploadOpen(false);
            setUploadReq(null);
          }}
          onDone={() => {
            setUploadOpen(false);
            setUploadReq(null);
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
  onArchiveToggle: () => void;
  onDelete: () => void;
  onRestore: () => void;
}): JSX.Element {
  const toast = useToast();
  const kind = useMemo(
    () => detectKind(doc.currentContentType, doc.currentFilename ?? doc.title),
    [doc.currentContentType, doc.currentFilename, doc.title],
  );

  // Version history — a document may have several audited versions; any can be
  // previewed and downloaded. Skipped in the deleted view (getOne 404s there).
  const detail = useQuery({
    queryKey: ['engagement', engagementId, 'document', doc.id, 'detail'],
    queryFn: () =>
      apiFetch<{ versions: DocVersion[] }>(`/engagements/${engagementId}/documents/${doc.id}`),
    enabled: !deletedView,
  });
  const versions = detail.data?.versions ?? [];
  // null = the current version.
  const [versionId, setVersionId] = useState<string | null>(null);
  const activeVersion = versionId ? versions.find((v) => v.id === versionId) : undefined;
  const activeVersionNo = activeVersion?.versionNo ?? doc.currentVersionNo;
  const activeFilename = activeVersion?.filename ?? doc.currentFilename ?? doc.title;
  const previewPath = versionId
    ? `/engagements/${engagementId}/documents/${doc.id}/versions/${versionId}/download`
    : `/engagements/${engagementId}/documents/${doc.id}/download`;

  const [preview, setPreview] = useState<{
    loading: boolean;
    url?: string;
    text?: string;
    error?: string;
  }>({ loading: true });

  const downloadActive = async (): Promise<void> => {
    try {
      await downloadFile(previewPath, activeFilename);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

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
        const { blob } = await fetchBlob(previewPath);
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
  }, [previewPath, kind]);

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
          {versions.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-ink-muted">Version</label>
              <Select
                value={versionId ?? 'current'}
                onChange={(e) => setVersionId(e.target.value === 'current' ? null : e.target.value)}
                className="h-7 py-0 text-xs"
              >
                <option value="current">v{doc.currentVersionNo} (current)</option>
                {versions
                  .filter((v) => v.versionNo !== doc.currentVersionNo)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNo} · {formatDate(v.uploadedAt)}
                      {v.uploadedByName ? ` · ${v.uploadedByName}` : ''}
                    </option>
                  ))}
              </Select>
              {activeVersion?.note && (
                <span className="text-xs italic text-ink-faint" title={activeVersion.note}>
                  “{activeVersion.note}”
                </span>
              )}
              {versionId && (
                <span className="rounded bg-warning-50 px-1.5 py-0.5 text-[11px] font-medium text-warning-700">
                  Viewing v{activeVersionNo} (older)
                </span>
              )}
            </div>
          )}
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
            <Button size="sm" variant="secondary" onClick={() => void downloadActive()}>
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
            <Button size="sm" variant="secondary" onClick={() => void downloadActive()}>
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

/** Required-documents checklist for a component-work period: satisfied vs missing. */
function ChecklistStrip({
  items,
  canManage,
  onUploadFor,
}: {
  items: ComponentDocChecklistItem[];
  canManage: boolean;
  onUploadFor: (req: { id: string; name: string }) => void;
}): JSX.Element {
  const done = items.filter((i) => i.satisfied).length;
  const missingMandatory = items.filter((i) => i.isMandatory && !i.satisfied).length;
  return (
    <Card className="mb-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Required documents
        </h3>
        <span className="text-xs text-ink-muted">
          {done}/{items.length} filed
          {missingMandatory > 0 && (
            <span className="ml-2 font-medium text-danger-600">
              {missingMandatory} mandatory missing
            </span>
          )}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li key={i.requirementId}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                i.satisfied
                  ? 'border-success-600/30 bg-success-50 text-success-700'
                  : i.isMandatory
                    ? 'border-danger-600/30 bg-danger-50 text-danger-700'
                    : 'border-line bg-surface text-ink-muted'
              }`}
              title={i.description ?? undefined}
            >
              {i.satisfied ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-3.5 w-3.5" />
              )}
              {i.name}
              {i.isMandatory && !i.satisfied && <span className="font-medium">*</span>}
              {i.documentCount > 1 && <span className="text-ink-faint">×{i.documentCount}</span>}
              {canManage && (
                <button
                  type="button"
                  onClick={() => onUploadFor({ id: i.requirementId, name: i.name })}
                  className="ml-0.5 rounded p-0.5 hover:bg-surface-sunken"
                  title={`Upload for ${i.name}`}
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UploadModal({
  engagementId,
  scope,
  scopeLabel,
  requirement,
  onClose,
  onDone,
}: {
  engagementId: string;
  scope?: DocumentScope;
  scopeLabel?: string;
  requirement?: { id: string; name: string } | null;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState(requirement?.name ?? '');
  const [documentType, setDocumentType] = useState('working_paper');
  const [classification, setClassification] = useState('internal');
  const multi = files.length > 1;

  const upload = useMutation({
    mutationFn: async () => {
      // One document per file. Title applies only to a single upload; with many,
      // each file's own name is the title.
      for (const f of files) {
        const { base64, contentType } = await readFileBase64(f);
        await apiFetch(`/engagements/${engagementId}/documents`, {
          method: 'POST',
          body: {
            title: multi
              ? f.name.replace(/\.[^.]+$/, '') || f.name
              : title.trim() || requirement?.name || f.name,
            documentType,
            classification,
            filename: f.name,
            contentType,
            contentBase64: base64,
            ...(scope?.taskId ? { taskId: scope.taskId } : {}),
            ...(scope?.componentInstanceId
              ? { componentInstanceId: scope.componentInstanceId }
              : {}),
            ...(requirement ? { docRequirementId: requirement.id } : {}),
          },
        });
      }
      return files.length;
    },
    onSuccess: (n) => {
      toast(n === 1 ? 'Document uploaded.' : `Uploaded ${n} documents.`);
      onDone();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={requirement ? `Upload: ${requirement.name}` : 'Upload document'}
      description={
        requirement
          ? `Filed against the "${requirement.name}" checklist item${scopeLabel ? ` for ${scopeLabel}` : ''}.`
          : scopeLabel
            ? `Filed under ${scopeLabel}. Stored as versioned evidence; downloads are audited.`
            : 'Stored as versioned evidence; downloads are audited.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={files.length === 0 || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending
              ? 'Uploading…'
              : multi
                ? `Upload ${files.length} files`
                : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={requirement ? 'File' : 'File(s)'} required>
          <input
            ref={fileRef}
            type="file"
            multiple={!requirement}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              setFiles(list);
              if (list.length === 1 && !title) setTitle(list[0]!.name.replace(/\.[^.]+$/, ''));
            }}
            className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
          />
          {multi && (
            <p className="mt-1 text-xs text-ink-faint">
              {files.length} files selected — each is uploaded as its own document (named after the
              file).
            </p>
          )}
        </Field>
        {!multi && (
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title"
            />
          </Field>
        )}
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
