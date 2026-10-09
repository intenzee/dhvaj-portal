'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { fetchM365Session, syncM365Version, type M365EditorSession } from '@/lib/m365';
import { useToast } from '@/lib/toast';
import { Spinner, Button } from '@/components/ui';

/**
 * Embeds Microsoft's genuine Office-for-the-web surface for one document, backed
 * by ONE persistent SharePoint Online copy. Fetches a session from the API (which
 * RLS-checks access, ensures the live copy exists and mints a short-lived
 * ANONYMOUS sharing link so the file opens with NO per-user Microsoft sign-in),
 * then iframes the returned URL. When editing is enabled the file co-authors and
 * autosaves into the live copy; the portal pulls those saves back as a new
 * audited version automatically — when the editor closes and whenever the
 * portal window regains focus (the API compares SharePoint's cTag, so an
 * unchanged file is a no-op). Approved work (`editLocked`) opens read-only.
 *
 * SharePoint sometimes refuses to render its editor inside a cross-origin iframe
 * (frame-ancestors). We always offer an "Open in Microsoft 365" button that
 * launches the same URL in a new tab, which is not subject to that restriction —
 * the focus sync picks up edits made there when the user comes back.
 *
 * If Microsoft 365 editing is disabled or unavailable, it calls
 * {@link onUnsupported} so the host can fall back to OnlyOffice / built-ins.
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
          if (!quiet) toast(`Saved as version ${res.versionNo ?? ''}`.trim());
          onSavedRef.current?.();
        }
      } catch (err) {
        if (!quiet) toast(err instanceof ApiError ? err.message : 'Could not sync from Microsoft 365.', 'error');
      } finally {
        syncing.current = false;
      }
    },
    [engagementId, docId, toast],
  );

  // Edits made in the iframe or in the Microsoft 365 tab come back when the user
  // returns to the portal, and once more when the editor closes.
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
              <>Saves automatically · versions recorded on close{lastSync ? ` · synced ${lastSync}` : ''}</>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" /> Read-only
              </>
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(session.editorUrl, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-4 w-4" /> Open in Microsoft 365
          </Button>
        </div>
      )}
      {session?.editorUrl && (
        <iframe
          title="Microsoft 365 editor"
          src={session.editorUrl}
          className="min-h-0 w-full flex-1 border-0"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}
