'use client';

import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Download, X, FileQuestion, Pencil, Save, Loader2, Maximize2, Minimize2 } from 'lucide-react';
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
import { M365Editor } from '@/components/document-editor/m365-editor';
import { isM365Enabled } from '@/lib/m365';
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
  initialMode = 'view',
  onSaved,
}: {
  engagementId: string;
  doc: DocumentRow;
  onClose: () => void;
  canEdit?: boolean;
  /** Open straight into edit mode (built-in editors) instead of view. */
  initialMode?: 'view' | 'edit';
  onSaved?: () => void;
}): JSX.Element {
  const toast = useToast();
  const [state, setState] = useState<Loaded>({ loading: true });
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const editorRef = useRef<EditorHandle>(null);

  // Remember the maximized/windowed preference across opens.
  useEffect(() => {
    try {
      setMaximized(window.localStorage.getItem('dhvaj-doc-maximized') === '1');
    } catch {
      /* storage unavailable — windowed default */
    }
  }, []);
  const toggleMaximized = useCallback(() => {
    setMaximized((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('dhvaj-doc-maximized', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const downloadPath = `/engagements/${engagementId}/documents/${doc.id}/download`;

  // Editor precedence for Office/PDF files: Microsoft 365 (SharePoint Online,
  // when enabled) → OnlyOffice → built-in viewers. Each falls through to the
  // next if disabled or unreachable.
  const [m365Failed, setM365Failed] = useState(false);
  const [ooFailed, setOoFailed] = useState(false);
  const guessName = doc.currentFilename ?? doc.title;
  const officeKind = ['excel', 'word', 'pdf', 'csv'].includes(detectKind(null, guessName));
  const useM365 = officeKind && isM365Enabled && !m365Failed;
  const useOnlyOffice = officeKind && !useM365 && !ooFailed;
  // Either embedded editor fetches/holds the bytes itself and saves out-of-band.
  const liveEditor = useM365 || useOnlyOffice;

  useEffect(() => {
    // When an embedded editor (Microsoft 365 or OnlyOffice) handles the file, it
    // holds the bytes itself — we skip the local blob download entirely.
    if (liveEditor) {
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
  }, [downloadPath, reloadKey, liveEditor]);

  const requestClose = useCallback(() => {
    if (!liveEditor && mode === 'edit' && dirty && !window.confirm('Discard unsaved changes?')) return;
    // Embedded editors save out-of-band (OnlyOffice force-saves on teardown; the
    // Microsoft 365 editor autosaves + commits) — nudge the list to pick up any
    // new version.
    if (liveEditor && onSaved) {
      onSaved();
      window.setTimeout(onSaved, 2500);
    }
    onClose();
  }, [liveEditor, mode, dirty, onClose, onSaved]);

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
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 ${
        maximized ? 'p-0' : 'p-4'
      }`}
      onClick={requestClose}
    >
      <div
        className={`flex flex-col overflow-hidden border-line-strong bg-surface shadow-pop ${
          maximized
            ? 'h-screen w-screen rounded-none border-0'
            : 'h-[88vh] w-full max-w-5xl rounded-xl border'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">
              {doc.title}
              {useM365 && <span className="ml-2 text-xs font-normal text-primary-600">Microsoft 365 editor</span>}
              {useOnlyOffice && <span className="ml-2 text-xs font-normal text-primary-600">Live editor — saves on close</span>}
              {!liveEditor && mode === 'edit' && (
                <span className="ml-2 text-xs font-normal text-primary-600">Editing{dirty ? ' • unsaved' : ''}</span>
              )}
            </div>
            <div className="truncate text-xs text-ink-faint">
              {filename} · {humanize(doc.documentType)} · v{doc.currentVersionNo}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!liveEditor && mode === 'view' && editable && (
              <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {!liveEditor && mode === 'edit' && (
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
            {(liveEditor || mode === 'view') && (
              <Button size="sm" variant="secondary" onClick={() => void download()}>
                <Download className="h-4 w-4" /> Download
              </Button>
            )}
            <button
              onClick={toggleMaximized}
              className="rounded-lg p-2 text-ink-faint hover:bg-surface-sunken hover:text-ink"
              aria-label={maximized ? 'Restore window' : 'Maximize to full screen'}
              aria-pressed={maximized}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
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
          {useM365 && (
            <M365Editor
              engagementId={engagementId}
              docId={doc.id}
              onUnsupported={() => setM365Failed(true)}
              onSaved={onSaved}
            />
          )}
          {useOnlyOffice && (
            <OnlyOfficeEditor
              engagementId={engagementId}
              docId={doc.id}
              onUnsupported={() => setOoFailed(true)}
              onClose={requestClose}
            />
          )}
          {!liveEditor && state.loading && (
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
