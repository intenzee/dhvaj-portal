import { apiFetch } from '@/lib/api';

/**
 * Microsoft 365 (SharePoint Online) editing — client helpers.
 *
 * Gated by NEXT_PUBLIC_M365_ENABLED so the whole path stays inert until the
 * SharePoint site is provisioned and the flag is flipped. Microsoft 365 is the
 * only embedded Office editor; when off, the document preview shows the file in
 * the built-in viewers.
 */
export const isM365Enabled = process.env.NEXT_PUBLIC_M365_ENABLED === 'true';

export interface M365EditorSession {
  enabled: boolean;
  editorUrl: string;
  itemId: string;
  driveId: string;
  canEdit: boolean;
}

/**
 * SharePoint lets another site frame a document only in its read-only embed
 * view (`action=embedview`); the editing and full-view pages send
 * frame-ancestors / X-Frame-Options that allow Microsoft's own sites only. So
 * the portal shows the embed view inline and opens editing in a new tab.
 */
export function m365EmbedUrl(link: string): string {
  const url = new URL(link);
  url.searchParams.set('action', 'embedview');
  return url.toString();
}

/** The same sharing link opened full-page: editing when the link allows it. */
export function m365OpenUrl(link: string, canEdit: boolean): string {
  const url = new URL(link);
  if (canEdit) url.searchParams.set('action', 'edit');
  else url.searchParams.delete('action');
  return url.toString();
}

interface ScreenArea {
  availWidth: number;
  availHeight: number;
  availLeft?: number;
  availTop?: number;
}

/**
 * window.open features for the Word / Excel / PowerPoint window: a popup on
 * the right of the screen (60% of its width, at least 900px when it fits) so
 * the portal stays visible beside it.
 */
export function editorWindowFeatures(area: ScreenArea): string {
  const width = Math.min(area.availWidth, Math.max(900, Math.round(area.availWidth * 0.6)));
  const height = area.availHeight;
  const left = (area.availLeft ?? 0) + area.availWidth - width;
  const top = area.availTop ?? 0;
  return `popup,width=${width},height=${height},left=${left},top=${top}`;
}

/** Ask the API to build an embedded Microsoft 365 editor session for a document. */
export function fetchM365Session(engagementId: string, docId: string): Promise<M365EditorSession> {
  return apiFetch<M365EditorSession>(
    `/engagements/${engagementId}/documents/${docId}/m365/session`,
    { method: 'POST' },
  );
}

export interface M365SyncResult {
  synced: boolean;
  /** Why nothing was pulled: unchanged, locked, read_only, no_live_copy, disabled. */
  reason: string | null;
  versionNo?: number;
}

/**
 * Pull the live Microsoft 365 copy back into the portal when SharePoint holds a
 * newer save (cTag compare) — a no-op when nothing changed. Called on editor
 * close and when the portal window regains focus; there is no manual commit.
 */
export function syncM365Version(engagementId: string, docId: string): Promise<M365SyncResult> {
  return apiFetch<M365SyncResult>(`/engagements/${engagementId}/documents/${docId}/m365/sync`, {
    method: 'POST',
  });
}
