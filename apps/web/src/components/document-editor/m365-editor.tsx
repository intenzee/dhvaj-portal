'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, ExternalLink } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { fetchM365Session, commitM365Version, type M365EditorSession } from '@/lib/m365';
import { useToast } from '@/lib/toast';
import { Spinner, Button } from '@/components/ui';

/**
 * Embeds Microsoft's genuine Office-for-the-web surface for one document, backed
 * by a SharePoint Online live copy. Fetches a session from the API (which
 * RLS-checks access, ensures the live copy exists and mints a short-lived
 * ANONYMOUS sharing link so the file opens with NO per-user Microsoft sign-in),
 * then iframes the returned URL. When editing is enabled the file co-authors and
 * autosaves into the live copy; the explicit "Commit version" button snapshots
 * it back into a new audited portal version. Otherwise it opens read-only in the
 * familiar Office viewer.
 *
 * SharePoint sometimes refuses to render its editor inside a cross-origin iframe
 * (frame-ancestors). We always offer an "Open in Microsoft 365" button that
 * launches the same URL in a new tab, which is not subject to that restriction.
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
  const [committing, setCommitting] = useState(false);
  const committedRef = useRef(false);

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

  const commit = async (): Promise<void> => {
    setCommitting(true);
    try {
      await commitM365Version(engagementId, docId);
      committedRef.current = true;
      toast('Committed as a new version.');
      onSaved?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Commit failed.', 'error');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised">
          <Spinner label="Opening Microsoft 365 editor…" />
        </div>
      )}
      {session && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-4 py-2">
          {session.canEdit && (
            <span className="text-xs text-ink-faint">
              Autosaves live · commit to record a version
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(session.editorUrl, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-4 w-4" /> Open in Microsoft 365
          </Button>
          {session.canEdit && (
            <Button size="sm" onClick={() => void commit()} disabled={committing}>
              {committing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {committing ? 'Committing…' : 'Commit version'}
            </Button>
          )}
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
