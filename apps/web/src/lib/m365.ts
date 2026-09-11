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

/** Commit the live Microsoft 365 copy back as a new audited version. */
export function commitM365Version(engagementId: string, docId: string): Promise<unknown> {
  return apiFetch(`/engagements/${engagementId}/documents/${docId}/m365/commit`, {
    method: 'POST',
  });
}
