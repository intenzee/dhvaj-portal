'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Lock, Pencil } from 'lucide-react';
import { ApiError } from '@/lib/api';
import {
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
 * the file is shown inline in that view and "Edit in Microsoft 365" opens
 * Word / Excel / PowerPoint for the web in a new tab. Edits there co-author and
 * autosave into the live copy; the portal pulls them back as a new audited
 * version when the user returns to the portal and when the editor closes (the
 * API compares SharePoint's cTag, so an unchanged file is a no-op), then
 * reloads the inline view. Approved work (`editLocked`) opens read-only.
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
  const syncing = useRef(false);
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

  /** Pull SharePoint's latest save into the portal, if it changed. */
  const sync = useCallback(
    async (quiet: boolean): Promise<void> => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const res = await syncM365Version(engagementId, docId);
        if (res.synced) {
          setLastSync(new Date().toLocaleTimeString());
          setViewKey((k) => k + 1);
          if (!quiet) toast(`Saved as version ${res.versionNo ?? ''}`.trim());
          onSavedRef.current?.();
        }
      } catch (err) {
        if (!quiet)
          toast(
            err instanceof ApiError ? err.message : 'Could not sync from Microsoft 365.',
            'error',
          );
      } finally {
        syncing.current = false;
      }
    },
    [engagementId, docId, toast],
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
            {session.canEdit ? (
              <>
                Edits save in Microsoft 365 and come back here as a new version
                {lastSync ? ` · synced ${lastSync}` : ''}
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" /> Read-only
              </>
            )}
          </span>
          <Button
            size="sm"
            variant={session.canEdit ? 'primary' : 'secondary'}
            onClick={() =>
              window.open(
                m365OpenUrl(session.editorUrl, session.canEdit),
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            {session.canEdit ? (
              <>
                <Pencil className="h-4 w-4" /> Edit in Microsoft 365
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4" /> Open in Microsoft 365
              </>
            )}
          </Button>
        </div>
      )}
      {session?.editorUrl && (
        <iframe
          key={viewKey}
          title="Microsoft 365 viewer"
          src={m365EmbedUrl(session.editorUrl)}
          className="min-h-0 w-full flex-1 border-0"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}
