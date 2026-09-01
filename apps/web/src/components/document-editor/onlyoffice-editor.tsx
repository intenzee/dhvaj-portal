'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { Spinner } from '@/components/ui';

interface EditorSession {
  enabled: boolean;
  dsPublicUrl: string;
  scriptUrl: string;
  config: Record<string, unknown>;
}

// The DS editor script defines a single global; load it at most once per page.
let scriptPromise: Promise<void> | null = null;
function loadDocsApi(src: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as unknown as { DocsAPI?: unknown }).DocsAPI) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the document editor.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Embeds the OnlyOffice editor for one document. Fetches a signed session from
 * the API, loads the DS script, and mounts the editor. If OnlyOffice is disabled
 * or unreachable, it calls {@link onUnsupported} so the host can fall back to the
 * built-in viewer. Saving happens through the DS callback (autosave / on close).
 */
export function OnlyOfficeEditor({
  engagementId,
  docId,
  onUnsupported,
  onClose,
}: {
  engagementId: string;
  docId: string;
  onUnsupported: (reason?: string) => void;
  onClose?: () => void;
}): JSX.Element {
  const holderId = useRef(`oo-${Math.random().toString(36).slice(2)}`).current;
  const editorRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await apiFetch<EditorSession>(
          `/engagements/${engagementId}/documents/${docId}/onlyoffice/session`,
          { method: 'POST' },
        );
        await loadDocsApi(session.scriptUrl);
        if (cancelled) return;
        const DocsAPI = (window as any).DocsAPI;
        if (!DocsAPI) throw new Error('Editor script did not initialise.');
        editorRef.current = new DocsAPI.DocEditor(holderId, {
          ...session.config,
          width: '100%',
          height: '100%',
          events: {
            onAppReady: () => {
              if (!cancelled) setLoading(false);
            },
            onRequestClose: () => onClose?.(),
            onError: (e: any) => {
              // Editor-level errors (e.g. download failure) — surface, don't crash.
              // eslint-disable-next-line no-console
              console.warn('OnlyOffice editor error', e);
            },
          },
        });
      } catch (err) {
        if (cancelled) return;
        // A 400 means OnlyOffice is disabled or the type is unsupported → fall back
        // to the built-in viewer. Other errors (DS down) also fall back.
        const reason = err instanceof ApiError ? err.message : 'The document editor is unavailable.';
        onUnsupported(reason);
        setError(reason);
      }
    })();
    return () => {
      cancelled = true;
      try {
        editorRef.current?.destroyEditor?.();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, docId]);

  return (
    <div className="relative h-full w-full">
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised">
          <Spinner label="Opening editor…" />
        </div>
      )}
      <div id={holderId} className="h-full w-full" />
    </div>
  );
}
