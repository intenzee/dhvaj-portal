import { apiFetch } from '@/lib/api';

/**
 * Microsoft 365 (SharePoint Online) editing — client helpers.
 *
 * Gated by NEXT_PUBLIC_M365_ENABLED so the whole path stays inert until the
 * SharePoint site is provisioned and the flag is flipped. When off, the document
 * preview falls back to OnlyOffice (and then the built-in editors) exactly as
 * before.
 */
export const isM365Enabled = process.env.NEXT_PUBLIC_M365_ENABLED === 'true';

export interface M365EditorSession {
  enabled: boolean;
  editorUrl: string;
  itemId: string;
  driveId: string;
  canEdit: boolean;
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
