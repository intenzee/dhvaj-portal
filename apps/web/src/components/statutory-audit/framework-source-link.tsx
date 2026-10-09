'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { DocumentPreview } from '@/components/document-preview';

/**
 * "Open Source" for a figure the 02.2 engine measured (spec §10): the linked
 * financial statements in the engagement workspace (opened from the portal —
 * Microsoft 365 when on), else an https link from the client master. Renders
 * nothing when the figure has no linked source.
 */
export function OpenSourceLink({
  engagementId,
  documentId,
  url,
}: {
  engagementId: string;
  documentId?: string | null;
  url?: string | null;
}): JSX.Element | null {
  const toast = useToast();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const cls = 'inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline';
  if (documentId) {
    return (
      <>
        <button
          type="button"
          className={cls}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setDoc(
                await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`),
              );
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Could not open the source.', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <ExternalLink className="h-3 w-3" /> Open Source
        </button>
        {doc && (
          <DocumentPreview
            engagementId={engagementId}
            doc={doc}
            canEdit={false}
            onClose={() => setDoc(null)}
            onSaved={() => undefined}
          />
        )}
      </>
    );
  }
  if (url && url.startsWith('https://')) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>
        <ExternalLink className="h-3 w-3" /> Open Source
      </a>
    );
  }
  return null;
}
