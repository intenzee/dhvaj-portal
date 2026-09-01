'use client';

import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Download, X, FileQuestion, Pencil, Save, Loader2 } from 'lucide-react';
import { apiFetch, fetchBlob, downloadFile, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Spinner, Button } from '@/components/ui';
import {
  detectKind,
  isEditable,
  blobToBase64,
  XLSX_MIME,
  DOCX_MIME,
  CSV_MIME,
  type FileKind,
} from '@/lib/file-kind';
import { SpreadsheetEditor } from '@/components/document-editor/spreadsheet-editor';
import { WordEditor } from '@/components/document-editor/word-editor';
import { TextEditor } from '@/components/document-editor/text-editor';
import { OnlyOfficeEditor } from '@/components/document-editor/onlyoffice-editor';
import type { EditorHandle } from '@/components/document-editor/types';
import type { DocumentRow } from '@/lib/types';

interface Loaded {
  loading: boolean;
  blob?: Blob;
  url?: string;
  contentType?: string;
  filename?: string;
  error?: string;
}

/** What to send when saving an edited file back as a new version. */
function outputFor(kind: FileKind, contentType: string, filename: string | null): { mime: string; filename: string } {
  const name = filename ?? 'document';
  const base = name.replace(/\.[^.]+$/, '') || 'document';
  switch (kind) {
    case 'excel':
      return { mime: XLSX_MIME, filename: `${base}.xlsx` };
    case 'csv':
      return { mime: CSV_MIME, filename: `${base}.csv` };
    case 'word':
      return { mime: DOCX_MIME, filename: `${base}.docx` };
    default:
      return { mime: contentType || 'text/plain', filename: name };
  }
}

/**
 * View and edit a document inline. PDFs and images render read-only; Excel, Word,
 * CSV and text files open in an in-app editor and can be saved back as a new
 * audited version (the API enforces edit permission — a non-lead gets a clear
 * message). Content-faithful round-trip; see the editor components for fidelity.
 */
export function DocumentPreview({
  engagementId,
  doc,
  onClose,
  canEdit = true,
  onSaved,
}: {
  engagementId: string;
  doc: DocumentRow;
  onClose: () => void;
  canEdit?: boolean;
  onSaved?: () => void;
}): JSX.Element {
  const toast = useToast();
  const [state, setState] = useState<Loaded>({ loading: true });
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const editorRef = useRef<EditorHandle>(null);
  const downloadPath = `/engagements/${engagementId}/documents/${doc.id}/download`;

  // Prefer the OnlyOffice editor (full Office fidelity) for Office/PDF files;
  // fall back to the built-in viewers if it is disabled or unreachable.
  const [ooFailed, setOoFailed] = useState(false);
  const guessName = doc.currentFilename ?? doc.title;
  const officeKind = ['excel', 'word', 'pdf', 'csv'].includes(detectKind(null, guessName));
  const useOnlyOffice = officeKind && !ooFailed;

  useEffect(() => {
    // When OnlyOffice handles the file, the DS fetches the bytes itself — we skip
    // the local blob download entirely.
    if (useOnlyOffice) {
      setState({ loading: false });
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      try {
        const { blob, contentType, filename } = await fetchBlob(downloadPath);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, blob, contentType, filename, url: objectUrl });
      } catch (err) {
        if (!cancelled)
          setState({ loading: false, error: err instanceof ApiError ? err.message : 'Could not load the file.' });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadPath, reloadKey, useOnlyOffice]);

  const requestClose = useCallback(() => {
    if (!useOnlyOffice && mode === 'edit' && dirty && !window.confirm('Discard unsaved changes?')) return;
    // OnlyOffice force-saves on teardown; nudge the list to pick up the new version.
    if (useOnlyOffice && onSaved) {
      onSaved();
      window.setTimeout(onSaved, 2500);
    }
    onClose();
  }, [useOnlyOffice, mode, dirty, onClose, onSaved]);

  // Close on Escape (respecting unsaved edits).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const ct = state.contentType ?? '';
  const filename = state.filename ?? doc.currentFilename ?? doc.title;
  const kind = detectKind(ct, filename);
  const editable = canEdit && isEditable(kind);

  const save = async (): Promise<void> => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      const out = outputFor(kind, ct, filename);
      const blob = await editorRef.current.export();
      const contentBase64 = await blobToBase64(blob);
      await apiFetch(`/engagements/${engagementId}/documents/${doc.id}/versions`, {
        method: 'POST',
        body: { filename: out.filename, contentType: out.mime, contentBase64, note: 'Edited in portal' },
      });
      toast('Saved as a new version.');
      setDirty(false);
      setMode('view');
      onSaved?.();
      setReloadKey((k) => k + 1); // re-fetch so the viewer shows the saved bytes
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async (): Promise<void> => {
    try {
      await downloadFile(downloadPath, filename);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  const markDirty = useCallback(() => setDirty(true), []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={requestClose}>
      <div
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">
              {doc.title}
              {useOnlyOffice && <span className="ml-2 text-xs font-normal text-primary-600">Live editor — saves on close</span>}
              {!useOnlyOffice && mode === 'edit' && (
                <span className="ml-2 text-xs font-normal text-primary-600">Editing{dirty ? ' • unsaved' : ''}</span>
              )}
            </div>
            <div className="truncate text-xs text-ink-faint">
              {filename} · {humanize(doc.documentType)} · v{doc.currentVersionNo}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!useOnlyOffice && mode === 'view' && editable && (
              <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {!useOnlyOffice && mode === 'edit' && (
              <>
                <Button size="sm" variant="secondary" onClick={requestClose} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save new version'}
                </Button>
              </>
            )}
            {(useOnlyOffice || mode === 'view') && (
              <Button size="sm" variant="secondary" onClick={() => void download()}>
                <Download className="h-4 w-4" /> Download
              </Button>
            )}
            <button
              onClick={requestClose}
              className="rounded-lg p-2 text-ink-faint hover:bg-surface-sunken hover:text-ink"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-surface-raised">
          {useOnlyOffice && (
            <OnlyOfficeEditor
              engagementId={engagementId}
              docId={doc.id}
              onUnsupported={() => setOoFailed(true)}
              onClose={requestClose}
            />
          )}
          {!useOnlyOffice && state.loading && (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading…" />
            </div>
          )}
          {!state.loading && state.error && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
              {state.error}
            </div>
          )}
          {!state.loading && !state.error && state.blob && (
            <Body
              kind={kind}
              readOnly={mode === 'view'}
              blob={state.blob}
              url={state.url}
              contentType={ct}
              title={doc.title}
              editorRef={editorRef}
              onDirty={markDirty}
              onDownload={() => void download()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Body({
  kind,
  readOnly,
  blob,
  url,
  contentType,
  title,
  editorRef,
  onDirty,
  onDownload,
}: {
  kind: FileKind;
  readOnly: boolean;
  blob: Blob;
  url?: string;
  contentType: string;
  title: string;
  editorRef: Ref<EditorHandle>;
  onDirty: () => void;
  onDownload: () => void;
}): JSX.Element {
  if (kind === 'pdf' && url) {
    return <iframe title={title} src={url} className="h-full w-full border-0" />;
  }
  if (kind === 'image' && url) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (kind === 'excel' || kind === 'csv') {
    return (
      <SpreadsheetEditor
        ref={editorRef}
        blob={blob}
        outputFormat={kind === 'csv' ? 'csv' : 'xlsx'}
        readOnly={readOnly}
        onDirty={onDirty}
      />
    );
  }
  if (kind === 'word') {
    return <WordEditor ref={editorRef} blob={blob} readOnly={readOnly} onDirty={onDirty} />;
  }
  if (kind === 'text') {
    return <TextEditor ref={editorRef} blob={blob} mime={contentType} readOnly={readOnly} onDirty={onDirty} />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileQuestion className="h-10 w-10 text-ink-faint" />
      <div className="text-sm text-ink-muted">No inline preview for this file type.</div>
      <Button size="sm" onClick={onDownload}>
        <Download className="h-4 w-4" /> Download to view
      </Button>
    </div>
  );
}
