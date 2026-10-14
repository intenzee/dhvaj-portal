'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Lock, Pencil } from 'lucide-react';
import { ApiError } from '@/lib/api';
import {
  editorWindowFeatures,
  fetchM365Session,
  m365EmbedUrl,
  m365OpenUrl,
  syncM365Version,
  type M365EditorSession,
} from '@/lib/m365';
import { useToast } from '@/lib/toast';
import { Spinner, Button } from '@/components/ui';

/**
 * Shows one document in Microsoft's genuine Office-for-the-web surface, backed
 * by ONE persistent SharePoint Online copy. Fetches a session from the API (which
 * RLS-checks access, ensures the live copy exists and mints a short-lived
 * ANONYMOUS sharing link so the file opens with NO per-user Microsoft sign-in).
 *
 * SharePoint allows another site to frame only its read-only embed view, so
 * the file is shown inline in that view and "Edit" opens Word / Excel /
 * PowerPoint for the web in a window beside the portal. Edits there co-author
 * and autosave into the live copy. "Done editing" (or closing that window)
 * pulls them back as a new audited version and reloads the inline view; the
 * portal also syncs when it regains focus and when the editor closes (the API
 * compares SharePoint's cTag, so an unchanged file is a no-op). Approved work
 * (`editLocked`) opens read-only.
 *
 * If Microsoft 365 editing is disabled or unavailable, it calls
 * {@link onUnsupported} so the host can fall back to the built-in viewers.
 */
export function M365Editor({
  engagementId,
  docId,
  onUnsupported,
  onSaved,
}: {
  engagementId: string;
  docId: string;
  onUnsupported: (reason?: string) => void;
  onSaved?: () => void;
}): JSX.Element {
  const toast = useToast();
  const [session, setSession] = useState<M365EditorSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // Bumped after a sync so the inline view shows the saved file.
  const [viewKey, setViewKey] = useState(0);
  // Until Microsoft's viewer has loaded in the frame.
  const [viewLoading, setViewLoading] = useState(true);
  const syncing = useRef<Promise<boolean> | null>(null);
  // The Word / Excel / PowerPoint window, while it is open.
  const editorWindow = useRef<Window | null>(null);
  const [editingOut, setEditingOut] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchM365Session(engagementId, docId);
        if (cancelled) return;
        if (!s.enabled || !s.editorUrl) throw new Error('Microsoft 365 editor unavailable.');
        setSession(s);
      } catch (err) {
        if (cancelled) return;
        const reason =
          err instanceof ApiError ? err.message : 'The Microsoft 365 editor is unavailable.';
        onUnsupported(reason);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId, docId]);

  const canEdit = session?.canEdit ?? false;

  /**
   * Pull SharePoint's latest save into the portal, if it changed. True when it
   * did; a call made while one is running waits for that one.
   */
  const sync = useCallback(
    (quiet: boolean): Promise<boolean> => {
      if (syncing.current) return syncing.current;
      const run = (async (): Promise<boolean> => {
        try {
          const res = await syncM365Version(engagementId, docId);
          if (res.synced) {
            setLastSync(new Date().toLocaleTimeString());
            setViewKey((k) => k + 1);
            setViewLoading(true);
            if (!quiet) toast(`Saved as version ${res.versionNo ?? ''}`.trim());
            onSavedRef.current?.();
          }
          return res.synced;
        } catch (err) {
          if (!quiet)
            toast(
              err instanceof ApiError ? err.message : 'Could not sync from Microsoft 365.',
              'error',
            );
          return false;
        } finally {
          syncing.current = null;
        }
      })();
      syncing.current = run;
      return run;
    },
    [engagementId, docId, toast],
  );

  /** Open the editor in a window beside the portal (a new tab if popups are blocked). */
  const startEditing = (): void => {
    if (!session) return;
    const url = m365OpenUrl(session.editorUrl, true);
    const open = editorWindow.current;
    if (open && !open.closed) {
      open.focus();
      return;
    }
    // Open blank first so the window can be cut off from the portal (no
    // opener) while the portal keeps a handle to focus and close it.
    const win = window.open('', `m365-${docId}`, editorWindowFeatures(window.screen));
    if (!win) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    win.opener = null;
    win.location.href = url;
    editorWindow.current = win;
    setEditingOut(true);
  };

  /**
   * Close the editor window and bring the edits back. Word autosaves every few
   * seconds, so when nothing new has landed yet the portal checks once more.
   */
  const finishEditing = useCallback(async (): Promise<void> => {
    const win = editorWindow.current;
    editorWindow.current = null;
    if (win && !win.closed) win.close();
    setEditingOut(false);
    setFinishing(true);
    try {
      if (await sync(false)) return;
      await new Promise((resolve) => setTimeout(resolve, 4000));
      if (!(await sync(false))) toast('No changes since the last version.');
    } finally {
      setFinishing(false);
    }
  }, [sync, toast]);

  // Closing the editor window counts as Done.
  useEffect(() => {
    if (!editingOut) return;
    const timer = window.setInterval(() => {
      if (editorWindow.current?.closed) void finishEditing();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [editingOut, finishEditing]);

  // Leaving the document closes its editor window too (the unmount sync below
  // brings the last edits back).
  useEffect(
    () => () => {
      const win = editorWindow.current;
      if (win && !win.closed) win.close();
    },
    [],
  );

  // Edits made in the Microsoft 365 tab come back when the user returns to the
  // portal, and once more when the editor closes.
  useEffect(() => {
    if (!canEdit) return;
    const onFocus = (): void => void sync(false);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void sync(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      void sync(true);
    };
  }, [canEdit, sync]);

  return (
    <div className="relative flex h-full w-full flex-col">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised">
          <Spinner label="Opening Microsoft 365 editor…" />
        </div>
      )}
      {session && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-4 py-2">
          <span className="flex items-center gap-1 text-xs text-ink-faint">
            {finishing ? (
              <>Saving your edits…</>
            ) : editingOut ? (
              <>Editing in the Microsoft 365 window · saves automatically</>
            ) : session.canEdit ? (
              <>
                Edits come back here as a new version
                {lastSync ? ` · synced ${lastSync}` : ''}
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" /> Read-only
              </>
            )}
          </span>
          {!session.canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                window.open(m365OpenUrl(session.editorUrl, false), '_blank', 'noopener,noreferrer')
              }
            >
              <ExternalLink className="h-4 w-4" /> Open in Microsoft 365
            </Button>
          ) : editingOut ? (
            <>
              <Button size="sm" variant="secondary" onClick={startEditing}>
                <ExternalLink className="h-4 w-4" /> Show editor
              </Button>
              <Button size="sm" onClick={() => void finishEditing()}>
                <Check className="h-4 w-4" /> Done editing
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={startEditing} disabled={finishing}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      )}
      {session?.editorUrl && (
        <div className="relative min-h-0 w-full flex-1">
          {viewLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-raised">
              <Spinner label="Loading the document…" />
            </div>
          )}
          <iframe
            key={viewKey}
            title="Microsoft 365 viewer"
            src={m365EmbedUrl(session.editorUrl)}
            onLoad={() => setViewLoading(false)}
            className="h-full w-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}
    </div>
  );
}
