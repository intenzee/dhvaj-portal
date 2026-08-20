'use client';

import { useEffect, useState } from 'react';
import { Download, X, FileQuestion } from 'lucide-react';
import { fetchBlob, downloadFile, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Spinner, Button } from '@/components/ui';
import type { DocumentRow } from '@/lib/types';

interface Loaded {
  loading: boolean;
  url?: string;
  text?: string;
  contentType?: string;
  error?: string;
}

/** Quick-look preview of a document — inline PDF / image / text, download fallback otherwise. */
export function DocumentPreview({
  engagementId,
  doc,
  onClose,
}: {
  engagementId: string;
  doc: DocumentRow;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const [state, setState] = useState<Loaded>({ loading: true });
  const downloadPath = `/engagements/${engagementId}/documents/${doc.id}/download`;

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { blob, contentType } = await fetchBlob(downloadPath);
        if (cancelled) return;
        if (contentType.startsWith('text/') || contentType === 'application/json') {
          const text = await blob.text();
          if (!cancelled) setState({ loading: false, contentType, text });
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setState({ loading: false, contentType, url: objectUrl });
          else URL.revokeObjectURL(objectUrl);
        }
      } catch (err) {
        if (!cancelled)
          setState({ loading: false, error: err instanceof ApiError ? err.message : 'Could not load the file.' });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadPath]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ct = state.contentType ?? '';
  const isPdf = ct === 'application/pdf';
  const isImage = ct.startsWith('image/');
  const previewable = isPdf || isImage || state.text !== undefined;

  const save = async (): Promise<void> => {
    try {
      await downloadFile(downloadPath, doc.currentFilename ?? doc.title);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{doc.title}</div>
            <div className="truncate text-xs text-ink-faint">
              {doc.currentFilename} · {humanize(doc.documentType)} · v{doc.currentVersionNo}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => void save()}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-ink-faint hover:bg-slate-100 hover:text-ink"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50">
          {state.loading && (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading preview…" />
            </div>
          )}
          {!state.loading && state.error && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
              {state.error}
            </div>
          )}
          {!state.loading && !state.error && (
            <>
              {isPdf && state.url && (
                <iframe title={doc.title} src={state.url} className="h-full w-full border-0" />
              )}
              {isImage && state.url && (
                <div className="flex h-full items-center justify-center p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={state.url} alt={doc.title} className="max-h-full max-w-full object-contain" />
                </div>
              )}
              {state.text !== undefined && (
                <pre className="h-full overflow-auto whitespace-pre-wrap p-5 text-xs text-ink">
                  {state.text}
                </pre>
              )}
              {!previewable && (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <FileQuestion className="h-10 w-10 text-ink-faint" />
                  <div className="text-sm text-ink-muted">
                    No inline preview for {humanize(doc.documentType)} files of this type.
                  </div>
                  <Button size="sm" onClick={() => void save()}>
                    <Download className="h-4 w-4" /> Download to view
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
